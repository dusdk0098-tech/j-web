import { richFonts,richSizes,normalizeRichStyle,normalizeRichLink,normalizeRichText,boardImageUrl,richTextFromEditor,richTextToHTML,richTextToPlain } from './rich-text.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function richBody(rich,plain,limits){try{return rich==null?escape(plain):richTextToHTML(rich,limits);}catch{return escape(plain);}}
export function richEditorMarkup(label,{tables=false}={}){
  const buttons=[['bold','굵게'],['italic','기울임'],['underline','밑줄'],['strikeThrough','취소선'],['alignLeft','왼쪽 정렬'],['alignCenter','가운데 정렬'],['alignRight','오른쪽 정렬'],['alignJustify','양쪽 정렬'],['indent','들여쓰기'],['outdent','내어쓰기'],['insertUnorderedList','글머리 목록'],['insertOrderedList','번호 목록'],['createLink','링크'],...(tables?[['insertTable','표 추가'],['addRow','행 추가'],['removeRow','행 삭제'],['addColumn','열 추가'],['removeColumn','열 삭제'],['removeTable','표 삭제']]:[])];
  const controls=`<label>글꼴<select data-rich-style="fontFamily"><option value="">선택</option>${richFonts.map(font=>`<option>${escape(font)}</option>`).join('')}</select></label><label>크기<select data-rich-style="fontSize"><option value="">선택</option>${richSizes.map(size=>`<option value="${size}">${size}px</option>`).join('')}</select></label><label>글자색<input type="color" data-rich-style="color" value="#000000"></label><button type="button" data-rich-apply="color">글자색 적용</button><label>배경색<input type="color" data-rich-style="backgroundColor" value="#ffffff"></label><button type="button" data-rich-apply="backgroundColor">배경색 적용</button>`;
  return `<div><span>${escape(label)}</span><div class="rich-toolbar" data-rich-toolbar role="toolbar" aria-label="본문 서식">${controls}${buttons.map(([command,name])=>`<button type="button" data-format="${command}">${name}</button>`).join('')}</div><div class="rich-editor" data-rich-editor contenteditable="true" role="textbox" aria-label="${escape(label)}" aria-multiline="true"></div></div>`;
}

export function mountRichEditor(root,{limits,onError=()=>{}}={}){
  const editor=root.querySelector('[data-rich-editor]'),toolbar=root.querySelector('[data-rich-toolbar]'),doc=editor.ownerDocument;
  let savedSelection=null;
  const writable=()=>{if(editor.contentEditable==='false'||editor.closest?.('[inert]'))throw Error('본문을 편집할 수 없는 상태입니다.');};
  const changed=()=>{rememberSelection();editor.dispatchEvent?.(new (doc.defaultView?.Event||Event)('input',{bubbles:true}));};
  const validRange=range=>range&&editor.isConnected!==false&&editor.contentEditable!=='false'&&editor.contains(range.startContainer)&&editor.contains(range.endContainer);
  const rememberSelection=()=>{const selection=doc.getSelection(),range=selection?.rangeCount?selection.getRangeAt(0):null;if(validRange(range))savedSelection={range:range.cloneRange(),start:range.startContainer,end:range.endContainer};};
  const restoreSelection=()=>{
    writable();const selection=doc.getSelection(),current=selection?.rangeCount?selection.getRangeAt(0):null;
    if(current&&!validRange(current)&&!toolbar.contains?.(current.startContainer)&&current.startContainer!==doc.body)throw Error('서식을 적용할 본문을 선택해 주세요.');
    const range=validRange(current)?current:savedSelection&&editor.contains(savedSelection.start)&&editor.contains(savedSelection.end)&&validRange(savedSelection.range)?savedSelection.range:null;
    if(!range)throw Error('서식을 적용할 본문을 선택해 주세요.');
    const copy=range.cloneRange();editor.focus();selection.removeAllRanges();selection.addRange(copy);return copy;
  };
  editor.onmouseup=editor.onkeyup=editor.onblur=rememberSelection;
  const insertBoardImage=image=>{
    writable();
    const normalized=normalizeRichText([image],limits)[0];if(normalized.type!=='image')throw Error('본문 이미지를 확인해 주세요.');
    const src=boardImageUrl(normalized,limits),node=doc.createElement('img');node.setAttribute('src',src);node.setAttribute('data-board-image-id',String(normalized.attachmentId));node.setAttribute('data-board-image-version',normalized.fileVersion);node.setAttribute('alt',normalized.alt);node.style.maxWidth='100%';node.style.height='auto';
    const selection=doc.getSelection(),current=selection?.rangeCount?selection.getRangeAt(0):null,selected=validRange(current)?current:savedSelection&&editor.contains(savedSelection.start)&&editor.contains(savedSelection.end)&&validRange(savedSelection.range)?savedSelection.range:null,range=selected?selected.cloneRange():doc.createRange();
    if(!selected){range.selectNodeContents(editor);range.collapse(false);}
    range.deleteContents();range.insertNode(node);range.setStartAfter(node);range.collapse(true);editor.focus();selection?.removeAllRanges();selection?.addRange(range);changed();
  };
  const insertPlain=value=>{const selection=doc.getSelection(),range=selection?.rangeCount?selection.getRangeAt(0):null,node=doc.createTextNode(value);if(!range||!editor.contains(range.commonAncestorContainer)){editor.append(node);editor.focus();return;}range.deleteContents();range.insertNode(node);range.setStartAfter(node);range.collapse(true);selection.removeAllRanges();selection.addRange(range);};
  editor.onpaste=event=>{event.preventDefault();try{writable();insertPlain(event.clipboardData?.getData('text/plain')||'');changed();}catch(error){onError(error);}};
  editor.ondrop=event=>{event.preventDefault();try{writable();insertPlain(event.dataTransfer?.getData('text/plain')||'');changed();}catch(error){onError(error);}};
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
  const inlineStyle=(key,value)=>{
    const style=normalizeRichStyle({[key]:key==='fontSize'?Number(value):value}),range=restoreSelection();
    if(range.collapsed)throw Error('서식을 적용할 글자를 선택해 주세요.');
    const walker=doc.createTreeWalker(editor,4),parts=[];let node;
    while(node=walker.nextNode())if(range.intersectsNode(node)){
      const start=node===range.startContainer?range.startOffset:0,end=node===range.endContainer?range.endOffset:node.length;
      if(end>start)parts.push({node,start,end});
    }
    if(!parts.length)throw Error('서식을 적용할 글자를 선택해 주세요.');
    const spans=[];
    for(const {node,start,end} of parts){
      const parent=node.parentElement,simple=parent?.tagName==='SPAN'&&parent.childNodes.length===1,reuse=simple&&start===0&&end===node.length,span=reuse?parent:simple?parent.cloneNode(false):doc.createElement('span');
      span.style[key]=key==='fontSize'?style[key]+'px':style[key];
      if(simple&&!reuse){
        const container=parent.parentElement;
        for(const [value,selected] of [[node.nodeValue.slice(0,start),false],[node.nodeValue.slice(start,end),true],[node.nodeValue.slice(end),false]])if(value){const piece=selected?span:parent.cloneNode(false);piece.append(doc.createTextNode(value));container.insertBefore(piece,parent);}
        parent.remove();
      }else if(!reuse){const part=doc.createRange();part.setStart(node,start);part.setEnd(node,end);part.surroundContents(span);}spans.push(span);
    }
    range.setStartBefore(spans[0]);range.setEndAfter(spans.at(-1));const selection=doc.getSelection();selection.removeAllRanges();selection.addRange(range);changed();
  };
  const blockStyle=command=>{
    const range=restoreSelection(),start=range.startContainer,end=range.endContainer,startOffset=range.startOffset,endOffset=range.endOffset,startChild=start===editor?editor.childNodes[startOffset]:null,endChild=end===editor?editor.childNodes[endOffset-1]:null;
    let group=null;
    for(const node of [...editor.childNodes]){
      if(node.nodeType===1&&['P','DIV','UL','OL','TABLE'].includes(node.tagName)){group=null;continue;}
      if(!group){group=doc.createElement('div');editor.insertBefore(group,node);}group.append(node);
    }
    if(start!==editor)range.setStart(start,startOffset);else if(startChild)range.setStartBefore(startChild);
    if(end!==editor)range.setEnd(end,endOffset);else if(endChild)range.setEndAfter(endChild);
    const blocks=[...editor.querySelectorAll('p,div,li,td,th')].filter(node=>range.intersectsNode(node));
    for(const block of blocks.filter(node=>!blocks.some(other=>other!==node&&node.contains(other))||[...node.childNodes].some(child=>!(child.nodeType===1&&['P','DIV','UL','OL','LI','TABLE','TD','TH'].includes(child.tagName))&&range.intersectsNode(child)))){
      if(command.startsWith('align'))block.style.textAlign=command.slice(5).toLowerCase();
      else {const old=parseInt(block.style.marginLeft)||0;block.style.marginLeft=Math.max(0,Math.min(192,old+(command==='indent'?24:-24)))+'px';}
    }
    const selection=doc.getSelection();selection.removeAllRanges();selection.addRange(range);changed();
  };
  toolbar.onmousedown=event=>{rememberSelection();if(event.target.closest('button'))event.preventDefault();};
  toolbar.onchange=event=>{const control=event.target.closest('[data-rich-style]');if(!control||!control.value)return;try{inlineStyle(control.dataset.richStyle,control.value);}catch(error){onError(error);}finally{if(['fontFamily','fontSize'].includes(control.dataset.richStyle))control.value='';}};
  toolbar.onclick=event=>{const apply=event.target.closest('[data-rich-apply]');if(apply?.dataset.richApply){try{const key=apply.dataset.richApply;if(!['color','backgroundColor'].includes(key))return;inlineStyle(key,toolbar.querySelector(`[data-rich-style="${key}"]`).value);}catch(error){onError(error);}return;}const button=event.target.closest('[data-format]');if(!button)return;try{
    writable();const command=button.dataset.format;
    if(['alignLeft','alignCenter','alignRight','alignJustify','indent','outdent'].includes(command)){blockStyle(command);return;}
    if(['insertTable','addRow','removeRow','addColumn','removeColumn','removeTable'].includes(command)){if(command!=='insertTable')restoreSelection();tableAction(command);changed();return;}
    if(!['bold','italic','underline','strikeThrough','insertUnorderedList','insertOrderedList','createLink'].includes(command))throw Error('허용되지 않은 본문 서식입니다.');
    const range=restoreSelection();let value=null;if(command==='createLink'){if(range.collapsed)throw Error('링크를 적용할 글자를 선택해 주세요.');const entered=prompt('HTTP 또는 HTTPS 링크 주소를 입력하세요.');if(entered===null)return;value=normalizeRichLink(entered);}
    if(!doc.execCommand(command,false,value))throw Error('이 브라우저에서 해당 서식을 적용할 수 없습니다.');changed();
  }catch(error){onError(error);}};
  return {insertBoardImage,value:()=>richTextFromEditor(editor,limits),plain:()=>richTextToPlain(richTextFromEditor(editor,limits),limits),set:(rich,plain='')=>{savedSelection=null;if(rich==null)editor.textContent=plain;else{editor.innerHTML=richTextToHTML(rich,limits);editor.querySelectorAll('td:empty,th:empty').forEach(cell=>cell.append(doc.createElement('br')));}},clear:()=>{savedSelection=null;editor.replaceChildren();},focus:()=>editor.focus(),hasTable:()=>!!editor.querySelector('table')};
}
