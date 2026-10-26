function messageFor(error) {
  if (['AbortError','TimeoutError'].includes(error?.name)) return '连接超时，已保留现有学生，请稍后重试。';
  const text=String(error?.message||'');
  if (/fetch failed|ERR_|network|ENOTFOUND|ECONN|socket/i.test(text)) return '暂时无法连接下载服务，已保留现有学生，请稍后重试。';
  if (/^(?:ENOENT|EACCES|EPERM)|JSON|Unexpected token|Unexpected end/i.test(text)) return '目录或文件暂时无法读取，已保留现有学生，请重试或查看启动日志。';
  return text.slice(0,220)||'操作未完成，已保留现有学生，请稍后重试。';
}
async function packageOperation(action, snapshot, successMessage='') {
  try {
    const result=await action();
    return {...snapshot(),operation:{ok:result!==false,message:result===false?'操作已取消。':typeof successMessage==='function'?successMessage():successMessage}};
  } catch(error) {
    return {...snapshot(),operation:{ok:false,message:messageFor(error)}};
  }
}
module.exports={packageOperation,messageFor};
