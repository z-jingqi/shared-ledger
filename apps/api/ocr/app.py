import io
import fitz
from fastapi import FastAPI, HTTPException, Request
from PIL import Image
from paddleocr import PaddleOCR

app = FastAPI()
ocr = PaddleOCR(use_angle_cls=True, lang="ch")

def image_text(image: Image.Image):
    result = ocr.ocr(image, cls=True)
    rows = [line for page in result for line in (page or [])]
    text = "\n".join(line[1][0] for line in rows)
    confidence = sum(line[1][1] for line in rows) / len(rows) if rows else 0
    return text, confidence

@app.post("/recognize")
async def recognize(request: Request):
    body = await request.body()
    mime_type = request.headers.get("content-type", "")
    if not body:
        raise HTTPException(status_code=400, detail="empty file")
    if mime_type == "application/pdf":
        document = fitz.open(stream=body, filetype="pdf")
        rendered = [Image.open(io.BytesIO(page.get_pixmap(dpi=180).tobytes("png"))).convert("RGB") for page in document]
    elif mime_type.startswith("image/"):
        rendered = [Image.open(io.BytesIO(body)).convert("RGB")]
    else:
        raise HTTPException(status_code=415, detail="unsupported content type")
    recognized = [image_text(image) for image in rendered]
    text = "\n".join(value[0] for value in recognized if value[0])
    confidence = sum(value[1] for value in recognized) / len(recognized) if recognized else 0
    return {"text": text, "confidence": confidence, "pages": len(rendered)}
