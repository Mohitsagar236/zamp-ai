// Minimal PDF with a Standard Security Handler. No private content or real key.
export function encryptedPDF() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>",
    "<< /Filter /Standard /V 1 /R 2 /O <" +
      "00".repeat(32) +
      "> /U <" +
      "00".repeat(32) +
      "> /P -4 >>",
  ];
  let text = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(text));
    text += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = Buffer.byteLength(text);
  text += `xref\n0 5\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1))
    text += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  text += `trailer\n<< /Size 5 /Root 1 0 R /Encrypt 4 0 R /ID [<${"11".repeat(16)}> <${"11".repeat(16)}>] >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(text);
}
