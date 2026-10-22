"""PDF toolbox Flask application."""
import json
import re
import subprocess
import tempfile
import uuid
from pathlib import Path

import fitz
from flask import Flask, jsonify, render_template, request, send_file
from werkzeug.utils import secure_filename

app = Flask(__name__)
UPLOAD_FOLDER = Path(tempfile.mkdtemp(prefix="pdf_tool_"))
MAX_FILE_SIZE = 500 * 1024 * 1024
MAX_TOTAL_SIZE = 500 * 1024 * 1024
app.config["MAX_CONTENT_LENGTH"] = MAX_TOTAL_SIZE
app.file_storage = {}
PAPER_SIZES = {"A4": (595.28, 841.89), "A3": (841.89, 1190.55)}


def error(message, status=400):
    return jsonify(success=False, error=message), status


def parse_pages(value, page_count):
    if not value or not value.strip():
        return list(range(1, page_count + 1))
    result, seen = [], set()
    for token in re.split(r"[\s,，;；]+", value.strip()):
        match = re.fullmatch(r"(\d+)(?:\s*[-~至]\s*(\d+))?", token)
        if not match:
            raise ValueError(f"无法识别页码：{token}")
        start, end = int(match.group(1)), int(match.group(2) or match.group(1))
        if start > end or start < 1 or end > page_count:
            raise ValueError(f"页码必须在 1 到 {page_count} 之间")
        for page in range(start, end + 1):
            if page not in seen:
                seen.add(page)
                result.append(page)
    return result


def make_selected(source, output, ordered_pages):
    target = fitz.open()
    try:
        for page_number in ordered_pages:
            target.insert_pdf(source, from_page=page_number - 1, to_page=page_number - 1)
        target.save(output)
    finally:
        target.close()


def resize_document(source, output, paper):
    width, height = PAPER_SIZES[paper]
    target = fitz.open()
    try:
        for source_page in source:
            page = target.new_page(width=width, height=height)
            rect = source_page.rect
            target_w, target_h = (height, width) if rect.width > rect.height else (width, height)
            scale = min(target_w / rect.width, target_h / rect.height)
            draw_w, draw_h = rect.width * scale, rect.height * scale
            page.show_pdf_page(fitz.Rect((width - draw_w) / 2, (height - draw_h) / 2,
                                         (width + draw_w) / 2, (height + draw_h) / 2),
                               source, source_page.number)
        target.save(output)
    finally:
        target.close()


def process_all(info, page_size, pages_text, profile, order):
    source = fitz.open(info["input"])
    current = source
    temporary = []
    try:
        page_count = source.page_count
        selected = parse_pages(pages_text, page_count)
        try:
            ordered = [int(value) for value in json.loads(order)] if order else list(range(1, page_count + 1))
        except (TypeError, json.JSONDecodeError, ValueError):
            raise ValueError("页面顺序数据无效")
        if sorted(ordered) != list(range(1, page_count + 1)):
            raise ValueError("页面顺序必须包含每一页且不能重复")
        selected_set = set(selected)
        ordered_selected = [page for page in ordered if page in selected_set]
        if not ordered_selected:
            raise ValueError("至少保留一页")
        changed = ordered != list(range(1, page_count + 1)) or len(selected) != page_count
        if changed:
            path = UPLOAD_FOLDER / f"{info['id']}_selected.pdf"
            make_selected(current, path, ordered_selected)
            temporary.append(path)
            current.close()
            current = fitz.open(path)
        if page_size in PAPER_SIZES:
            path = UPLOAD_FOLDER / f"{info['id']}_{page_size}.pdf"
            resize_document(current, path, page_size)
            temporary.append(path)
            current.close()
            current = fitz.open(path)
        output = UPLOAD_FOLDER / f"{info['id']}_output.pdf"
        input_for_compress = temporary[-1] if temporary else info["input"]
        if profile in {"/screen", "/ebook", "/printer"}:
            current.close()
            command = ["gswin64.exe", "-dNOPAUSE", "-dBATCH", "-sDEVICE=pdfwrite",
                       f"-dPDFSETTINGS={profile}", "-dCompatibilityLevel=1.4",
                       f"-sOutputFile={output}", str(input_for_compress)]
            result = subprocess.run(command, capture_output=True, text=True, check=False)
            if result.returncode != 0 or not output.exists():
                raise RuntimeError("压缩失败，请确认 Ghostscript 已安装")
        else:
            current.save(output)
            current.close()
        info["output"] = output
        info["download_name"] = f"{Path(info['name']).stem}_edited.pdf"
    finally:
        if not current.is_closed:
            current.close()


@app.get("/")
def index():
    return render_template("index.html")


@app.post("/upload")
def upload_file():
    uploads = [item for item in request.files.getlist("files") if item and item.filename]
    if not uploads:
        single = request.files.get("file")
        uploads = [single] if single else []
    if not uploads:
        return error("没有选择文件")
    file_id = request.form.get("file_id") or uuid.uuid4().hex
    existing = app.file_storage.get(file_id)
    if request.form.get("file_id") and existing is None:
        return error("上传会话不存在或已过期", 404)
    old_size = existing.get("upload_bytes", 0) if existing else 0
    incoming_size = 0
    for uploaded in uploads:
        if not uploaded.filename.lower().endswith(".pdf"):
            return error("只能上传 PDF 文件")
        uploaded.stream.seek(0, 2)
        size = uploaded.stream.tell()
        uploaded.stream.seek(0)
        if size > MAX_FILE_SIZE:
            return error("单个文件不能超过 500 MB", 413)
        incoming_size += size
    if old_size + incoming_size > MAX_TOTAL_SIZE:
        return error("上传文件总大小不能超过 500 MB", 413)

    merged_path = UPLOAD_FOLDER / f"{file_id}_input.pdf"
    temp_path = UPLOAD_FOLDER / f"{file_id}_merge_tmp.pdf"
    merged = fitz.open()
    names = []
    try:
        if existing:
            old_document = fitz.open(existing["input"])
            merged.insert_pdf(old_document)
            old_document.close()
            names.extend(existing["names"])
        for index, uploaded in enumerate(uploads):
            source_path = UPLOAD_FOLDER / f"{file_id}_incoming_{index}.pdf"
            uploaded.save(source_path)
            actual_size = source_path.stat().st_size
            if actual_size > MAX_FILE_SIZE:
                source_path.unlink(missing_ok=True)
                raise ValueError("单个文件不能超过 500 MB")
            document = fitz.open(source_path)
            merged.insert_pdf(document)
            document.close()
            source_path.unlink(missing_ok=True)
            names.append(secure_filename(uploaded.filename))
        if merged.page_count == 0:
            raise ValueError("PDF 文件没有可用页面")
        merged.save(temp_path)
        pages = merged.page_count
    except Exception as exc:
        if not merged.is_closed:
            merged.close()
        temp_path.unlink(missing_ok=True)
        return error(str(exc) if isinstance(exc, ValueError) else "文件不是有效的 PDF")
    finally:
        if not merged.is_closed:
            merged.close()
    temp_path.replace(merged_path)
    upload_bytes = old_size + incoming_size
    info = existing or {"id": file_id}
    info.update({"input": merged_path, "name": names[0] if len(names) == 1 else "merged.pdf",
                 "names": names, "pages": pages, "upload_bytes": upload_bytes})
    info.pop("output", None)
    info.pop("download_name", None)
    app.file_storage[file_id] = info
    return jsonify(success=True, file_id=file_id, pages=pages, names=names, size=upload_bytes, upload_bytes=upload_bytes)


@app.get("/preview/<file_id>/<int:page_number>")
def preview_page(file_id, page_number):
    info = app.file_storage.get(file_id)
    if not info or page_number < 1 or page_number > info["pages"]:
        return error("预览页面不存在", 404)
    document = fitz.open(info["input"])
    try:
        page = document.load_page(page_number - 1)
        pixmap = page.get_pixmap(matrix=fitz.Matrix(1.25, 1.25), alpha=False)
        return pixmap.tobytes("png"), 200, {"Content-Type": "image/png", "Cache-Control": "public, max-age=3600"}
    finally:
        document.close()


@app.post("/process")
def process_pdf():
    file_id = request.form.get("file_id", "")
    info = app.file_storage.get(file_id)
    if not info or not info["input"].exists():
        return error("文件不存在或已过期", 404)
    page_size = request.form.get("page_size", "original")
    profile = request.form.get("profile", "none")
    if page_size not in {"original", *PAPER_SIZES}:
        return error("页面大小只支持原始、A3 或 A4")
    if profile not in {"none", "/screen", "/ebook", "/printer"}:
        return error("压缩配置无效")
    try:
        process_all(info, page_size, request.form.get("pages", ""), profile, request.form.get("order", ""))
        return jsonify(success=True, download_name=info["download_name"], size=info["output"].stat().st_size)
    except (ValueError, RuntimeError) as exc:
        return error(str(exc))
    except Exception as exc:
        return error(f"处理失败：{exc}")


@app.get("/download/<file_id>")
def download_file(file_id):
    info = app.file_storage.get(file_id)
    if not info or "output" not in info or not info["output"].exists():
        return error("处理后的文件不存在或已过期", 404)
    return send_file(info["output"], as_attachment=True, download_name=info["download_name"], mimetype="application/pdf")


if __name__ == "__main__":
    UPLOAD_FOLDER.mkdir(parents=True, exist_ok=True)
    app.run(debug=True, host="0.0.0.0", port=6080)
