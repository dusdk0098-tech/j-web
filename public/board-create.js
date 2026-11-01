export const boardCreateMarkup='<label data-board-files-label>첨부파일 (각 2MB 이하, 최대 10개)<input type="file" data-board-files multiple></label><p data-board-create-help>글과 첨부파일을 함께 저장합니다. 첨부 실패 시 글도 공개되지 않습니다. 응답이 끊기면 입력을 유지한 채 다시 저장하세요.</p>';
export function boardCreation(root,active){
  const input=root.querySelector('[data-board-files]');let token=crypto.randomUUID();
  return {reset(){token=crypto.randomUUID();input.value='';},async value(){
    if(!active())throw Error('작성 화면이 변경되었습니다. 다시 열어 주세요.');
    const files=[...(input.files||[])];if(files.length>10)throw Error('첨부파일은 최대 10개입니다.');
    for(const file of files){if(!file.size||file.size>2*1024*1024)throw Error('파일은 1바이트 이상 2MB 이하여야 합니다.');if(!file.name.trim()||file.name.length>200||/[\\/\x00-\x1f\x7f]/.test(file.name))throw Error('파일 이름을 확인해 주세요.');}
    const attachments=[];for(const file of files){const bytes=new Uint8Array(await file.arrayBuffer());if(!active())throw Error('작성 화면이 변경되었습니다. 다시 열어 주세요.');let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));attachments.push({name:file.name,base64:btoa(binary)});}
    return {creationToken:token,attachments};
  }};
}
