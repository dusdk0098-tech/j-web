// PDF.js가 손상된 이미지·글꼴을 생략하면 불완전한 문서를 인쇄하지 않는다.
const originalWarn=console.warn.bind(console);
console.warn=(...values)=>{if(values.some(value=>typeof value==='string'&&value.startsWith('Warning:')))self.postMessage({jwebPdfWarning:true});originalWarn(...values);};
await import('/pdfjs/pdf.worker.mjs');
