"""Download a deterministic bounded subset of a CC-BY-4.0 public corpus.

The ZIP is streamed from its start and closed after the requested image count;
we verify each member CRC and hash the original image, without downloading the
entire 410 MB archive. No private files are searched or sent anywhere.
"""
import hashlib
import io
import json
from pathlib import Path
import struct
import sys
import urllib.request
import zipfile
import zlib

root = Path(sys.argv[1] if len(sys.argv) > 1 else ".data/public-benchmark/portuguese-6371710")
count = int(sys.argv[2]) if len(sys.argv) > 2 else 20
if not 1 <= count <= 100:
    raise SystemExit("Choose 1–100 public documents")
root.mkdir(parents=True, exist_ok=True)
metadata = json.load(urllib.request.urlopen("https://zenodo.org/api/records/6371710", timeout=30))
if metadata["metadata"]["license"]["id"] != "cc-by-4.0":
    raise SystemExit("Publisher license changed; inspect before using")
(root / "source-metadata.json").write_text(json.dumps(metadata, indent=2))
files = {item["key"]: item for item in metadata["files"]}
annotation_path = root / "2_Annotations_Json.zip"
if not annotation_path.exists():
    annotation_path.write_bytes(urllib.request.urlopen(files[annotation_path.name]["links"]["self"], timeout=60).read())
annotation_bytes = annotation_path.read_bytes()
if files[annotation_path.name]["checksum"] != "md5:" + hashlib.md5(annotation_bytes).hexdigest():
    raise SystemExit("Publisher annotation checksum does not match")
labels = zipfile.ZipFile(io.BytesIO(annotation_bytes))

def exact(stream, size):
    chunks = []
    while size:
        data = stream.read(min(size, 1024 * 1024))
        if not data:
            raise EOFError("Incomplete ZIP member")
        chunks.append(data)
        size -= len(data)
    return b"".join(chunks)

def amount(value):
    if not value:
        return None
    value = str(value).strip()
    return value.replace(".", "").replace(",", ".") if "," in value else value

entries = []
archive = root / "1_Images.zip"
partial = root / "1_Images.download"
source = archive.open("rb") if archive.exists() else partial.open("rb") if partial.exists() else urllib.request.urlopen(files["1_Images.zip"]["links"]["self"], timeout=60)
with source:
    while len(entries) < count:
        header = exact(source, 30)
        values = struct.unpack("<IHHHHHIIIHH", header)
        signature, _, flags, method, _, _, crc, compressed, size, name_size, extra_size = values
        if signature != 0x04034B50 or flags & 8 or compressed > 20_000_000 or size > 30_000_000:
            raise ValueError("Unsupported or oversized public archive member")
        name = exact(source, name_size).decode("utf8")
        exact(source, extra_size)
        data = exact(source, compressed)
        if name.endswith("/"):
            continue
        data = zlib.decompress(data, -15) if method == 8 else data if method == 0 else None
        if data is None or len(data) != size or zlib.crc32(data) & 0xffffffff != crc:
            raise ValueError("Public image integrity check failed")
        filename = Path(name).name
        if Path(filename).suffix.lower() not in (".jpg", ".jpeg", ".png"):
            continue
        label = json.loads(labels.read("2_Annotations_Json/" + Path(filename).stem + ".txt"))
        images = root / "images"
        images.mkdir(exist_ok=True)
        (images / filename).write_bytes(data)
        expected = {"supplierName": label.get("company") or None, "invoiceNumber": label.get("invoice_number") or None, "invoiceDate": label.get("date") or None, "total": amount(label.get("total")), "tax": amount(label.get("iva_amount"))}
        # Missing annotations are unscored, not evidence that a source field is absent.
        expected = {key: value for key, value in expected.items() if value is not None}
        entries.append({"id": Path(filename).stem, "file": "images/" + filename, "sha256": hashlib.sha256(data).hexdigest(), "category": "public-Portuguese-invoice-or-receipt", "language": "pt", "scanQuality": "ungraded-public-photo", "supported": False, "expected": expected})

manifest = {"source": "https://zenodo.org/records/6371710", "citation": "Francisco Cruz and Mauro Castelli (2022), Dataset of invoices and receipts including annotation of relevant fields, DOI:10.5281/zenodo.6371710", "license": "CC-BY-4.0", "labelProvenance": "Publisher annotations; not two independent AP labels", "sampling": "First N ZIP image members in publisher order; not representative sampling", "entries": entries}
(root / "public-labels.json").write_text(json.dumps(manifest, indent=2))
print(json.dumps({"prepared": len(entries), "manifest": str(root / "public-labels.json"), "license": manifest["license"]}))
