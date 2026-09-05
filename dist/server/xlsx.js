import { escapeHtml } from "./util.js";

export function makeXlsx(sheets) {
  const files = new Map();
  files.set("[Content_Types].xml", contentTypes(sheets.length));
  files.set("_rels/.rels", rels());
  files.set("xl/workbook.xml", workbookXml(sheets));
  files.set("xl/_rels/workbook.xml.rels", workbookRels(sheets.length));
  files.set("xl/styles.xml", stylesXml());
  sheets.forEach((sheet, index) => {
    files.set(`xl/worksheets/sheet${index + 1}.xml`, sheetXml(sheet.rows || []));
  });
  return zipStore(files);
}

function contentTypes(count) {
  const sheets = Array.from({ length: count }, (_, i) =>
    `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${sheets}
</Types>`;
}

function rels() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
}

function workbookXml(sheets) {
  const entries = sheets.map((sheet, i) =>
    `<sheet name="${xmlAttr(sheet.name || `Sheet ${i + 1}`)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${entries}</sheets>
</workbook>`;
}

function workbookRels(count) {
  const entries = Array.from({ length: count }, (_, i) =>
    `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries}</Relationships>`;
}

function stylesXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="1"><font><sz val="11"/><name val="Arial"/></font></fonts>
<fills count="1"><fill><patternFill patternType="none"/></fill></fills>
<borders count="1"><border/></borders>
<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellXfs>
</styleSheet>`;
}

function sheetXml(rows) {
  const rowXml = rows.map((row, r) => {
    const cells = row.map((cell, c) => {
      const ref = `${colName(c + 1)}${r + 1}`;
      return `<c r="${ref}" t="inlineStr"><is><t>${escapeHtml(cell ?? "")}</t></is></c>`;
    }).join("");
    return `<row r="${r + 1}">${cells}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData>${rowXml}</sheetData>
</worksheet>`;
}

function colName(n) {
  let name = "";
  while (n > 0) {
    const mod = (n - 1) % 26;
    name = String.fromCharCode(65 + mod) + name;
    n = Math.floor((n - mod) / 26);
  }
  return name;
}

function xmlAttr(value) {
  return escapeHtml(value).slice(0, 31);
}

function zipStore(files) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of files.entries()) {
    const nameBytes = enc.encode(name);
    const data = enc.encode(text);
    const crc = crc32(data);
    const local = header(0x04034b50, [
      [2, 20], [2, 0], [2, 0], [2, 0], [2, 0],
      [4, crc], [4, data.length], [4, data.length],
      [2, nameBytes.length], [2, 0],
    ]);
    chunks.push(local, nameBytes, data);
    central.push({ nameBytes, crc, size: data.length, offset });
    offset += local.length + nameBytes.length + data.length;
  }
  let centralSize = 0;
  const centralChunks = [];
  for (const file of central) {
    const dir = header(0x02014b50, [
      [2, 20], [2, 20], [2, 0], [2, 0], [2, 0], [2, 0],
      [4, file.crc], [4, file.size], [4, file.size],
      [2, file.nameBytes.length], [2, 0], [2, 0], [2, 0], [2, 0], [4, 0], [4, file.offset],
    ]);
    centralChunks.push(dir, file.nameBytes);
    centralSize += dir.length + file.nameBytes.length;
  }
  const end = header(0x06054b50, [
    [2, 0], [2, 0], [2, central.length], [2, central.length],
    [4, centralSize], [4, offset], [2, 0],
  ]);
  return concat([...chunks, ...centralChunks, end]);
}

function header(signature, fields) {
  const size = 4 + fields.reduce((sum, [bytes]) => sum + bytes, 0);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  view.setUint32(0, signature, true);
  let offset = 4;
  for (const [bytes, value] of fields) {
    if (bytes === 2) {
      view.setUint16(offset, value, true);
    } else {
      view.setUint32(offset, value >>> 0, true);
    }
    offset += bytes;
  }
  return out;
}

function concat(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

const table = (() => {
  const out = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    out[i] = c >>> 0;
  }
  return out;
})();
