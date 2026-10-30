import { normalizeRichLink,richTextFromEditor,richTextToHTML,richTextToPlain } from './rich-text.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function richBody(rich,plain,limits){try{return rich==null?escape(plain):richTextToHTML(rich,limits);}catch{return escape(plain);}}
export function richEditorMarkup(label,{tables=false}={}){
  const buttons=[['bold','굵게'],['italic','기울임'],['underline','밑줄'],['strikeThrough','취소선'],['insertUnorderedList','글머리 목록'],['insertOrderedList','번호 목록'],['createLink','링크'],...(tables?[['insertTable','표 추가'],['addRow','행 추가'],['removeRow','행 삭제'],['addColumn','열 추가'],['removeColumn','열 삭제'],['removeTable','표 삭제']]:[])];
  return `<div><span>${escape(label)}</span><div class="rich-toolbar" data-rich-toolbar role="toolbar" aria-label="본문 서식">${buttons.map(([command,name])=>`<button type="button" data-format="${command}">${name}</button>`).join('')}</div><div class="rich-editor" data-rich-editor contenteditable="true" role="textbox" aria-label="${escape(label)}" aria-multiline="true"></div></div>`;
}

export function mountRichEditor(root,{limits,onError=()=>{}}={}){
  const editor=root.querySelector('[data-rich-editor]'),toolbar=root.querySelector('[data-rich-toolbar]'),doc=editor.ownerDocument;
  const insertPlain=value=>{const selection=doc.getSelection(),range=selection?.rangeCount?selection.getRangeAt(0):null,node=doc.createTextNode(value);if(!range||!editor.contains(range.commonAncestorContainer)){editor.append(node);editor.focus();return;}range.deleteContents();range.insertNode(node);range.setStartAfter(node);range.collapse(true);selection.removeAllRanges();selection.addRange(range);};
  editor.onpaste=event=>{event.preventDefault();insertPlain(event.clipboardData?.getData('text/plain')||'');};
  editor.ondrop=event=>{event.preventDefault();insertPlain(event.dataTransfer?.getData('text/plain')||'');};
  const focusCell=cell=>{editor.focus();const selection=doc.getSelection(),range=doc.createRange();range.selectNodeContents(cell);range.collapse(true);selection.removeAllRanges();selection.addRange(range);};
  const currentCell=()=>{const selection=doc.getSelection(),node=selection?.anchorNode,element=node?.nodeType===1?node:node?.parentElement,cell=element?.closest('td,th'),table=cell?.closest('table');if(!cell||!table||!editor.contains(table))throw Error('표 안의 칸을 선택해 주세요.');return {cell,table,row:cell.parentElement};};
  const newCell=()=>{const cell=doc.createElement('td');cell.append(doc.createElement('br'));return cell;};
  const tableAction=command=>{
    if(command==='insertTable'){
      const rows=prompt('표의 행 수를 입력하세요. (1~10)','2');if(rows===null)return;const columns=prompt('표의 열 수를 입력하세요. (1~10)','2');if(columns===null)return;
      if(!/^(?:[1-9]|10)$/.test(rows)||!/^(?:[1-9]|10)$/.test(columns))throw Error('행과 열은 각각 1부터 10까지 입력해 주세요.');
      const table=doc.createElement('table'),body=doc.createElement('tbody');for(let i=0;i<Number(rows);i++){const row=doc.createElement('tr');for(let j=0;j<Number(columns);j++)row.append(newCell());body.append(row);}table.append(body);editor.append(table);const after=doc.createElement('p');after.append(doc.createElement('br'));editor.append(after);focusCell(table.rows[0].cells[0]);return;
    }
    const {cell,table,row}=currentCell(),rows=[...table.rows],cells=[...row.cells],index=cells.indexOf(cell);
    if(command==='removeTable'){if(confirm('선택한 표를 삭제할까요?')){table.remove();editor.focus();}return;}
    if(rows.some(item=>item.cells.length!==cells.length))throw Error('같은 수의 칸이 있는 표를 선택해 주세요.');
    if(command==='addRow'){if(rows.length>=10)throw Error('표의 행은 10개까지 추가할 수 있습니다.');const added=doc.createElement('tr');for(let i=0;i<cells.length;i++)added.append(newCell());row.after(added);focusCell(added.cells[index]);}
    if(command==='removeRow'){if(rows.length<=1)throw Error('마지막 행은 표 삭제로 지워 주세요.');const position=rows.indexOf(row),next=rows[position+1]||rows[position-1];row.remove();focusCell(next.cells[index]);}
    if(command==='addColumn'){if(cells.length>=10)throw Error('표의 열은 10개까지 추가할 수 있습니다.');for(const item of rows)item.insertBefore(newCell(),item.cells[index+1]||null);focusCell(row.cells[index+1]);}
    if(command==='removeColumn'){if(cells.length<=1)throw Error('마지막 열은 표 삭제로 지워 주세요.');for(const item of rows)item.cells[index].remove();focusCell(row.cells[Math.min(index,row.cells.length-1)]);}
  };
  editor.onkeydown=event=>{if(event.key!=='Tab')return;try{const {cell,table}=currentCell(),cells=[...table.querySelectorAll('th,td')],next=cells[cells.indexOf(cell)+(event.shiftKey?-1:1)];if(next){event.preventDefault();focusCell(next);}}catch{}};
  toolbar.onmousedown=event=>{if(event.target.closest('button'))event.preventDefault();};
  toolbar.onclick=event=>{const button=event.target.closest('[data-format]');if(!button)return;try{const command=button.dataset.format;if(['insertTable','addRow','removeRow','addColumn','removeColumn','removeTable'].includes(command)){tableAction(command);return;}const selection=doc.getSelection();if(!selection?.rangeCount||!editor.contains(selection.getRangeAt(0).commonAncestorContainer))throw Error('서식을 적용할 본문을 선택해 주세요.');const range=selection.getRangeAt(0).cloneRange();let value=null;if(command==='createLink'){if(range.collapsed)throw Error('링크를 적용할 글자를 선택해 주세요.');const entered=prompt('HTTP 또는 HTTPS 링크 주소를 입력하세요.');if(entered===null)return;value=normalizeRichLink(entered);}editor.focus();selection.removeAllRanges();selection.addRange(range);if(!doc.execCommand(command,false,value))throw Error('이 브라우저에서 해당 서식을 적용할 수 없습니다.');}catch(error){onError(error);}};
  return {value:()=>richTextFromEditor(editor,limits),plain:()=>richTextToPlain(richTextFromEditor(editor,limits),limits),set:(rich,plain='')=>{if(rich==null)editor.textContent=plain;else{editor.innerHTML=richTextToHTML(rich,limits);editor.querySelectorAll('td:empty,th:empty').forEach(cell=>cell.append(doc.createElement('br')));}},clear:()=>editor.replaceChildren(),focus:()=>editor.focus(),hasTable:()=>!!editor.querySelector('table')};
}
