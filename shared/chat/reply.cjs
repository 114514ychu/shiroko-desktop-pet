// Keep spoken output separate from Chinese UI/history, including translation failures.
const kana = /[\u3040-\u30ff]/;
const english = text => /[a-z]/i.test(text) && !/[\u3040-\u30ff\u3400-\u9fff]/.test(text);
const chinese = text => typeof text === 'string' && text.trim() && !kana.test(text) && /[\u3400-\u9fff]/.test(text);
const strip = text => text.replace(/\[\/?(?:ja|en|zh)\]/gi, '').trim();
async function prepareReply(reply, { chat, japanese = false, signal } = {}) {
  let spoken = reply, primary = reply;
  if (japanese) {
    const ja = /\[ja\]([\s\S]*?)\[\/ja\]/i.exec(reply);
    const en = /\[en\]([\s\S]*?)\[\/en\]/i.exec(reply);
    const zh = /\[zh\]([\s\S]*?)\[\/zh\]/i.exec(reply);
    spoken = en ? strip(en[1]) : ja ? strip(ja[1]) : strip(reply);
    primary = zh ? strip(zh[1]) : chinese(spoken) ? spoken : '';
    if (!en && !english(spoken) && !kana.test(spoken) && chat?.toJapanese) {
      try { const converted = await chat.toJapanese(spoken, signal); if (kana.test(converted)) spoken = converted; } catch {}
    }
    if (!chinese(primary) && chat?.translate) {
      try { primary = await chat.translate(spoken, signal); } catch {}
    }
  }
  if (!chinese(primary)) primary = '中文台词暂时不可用，请重试。';
  return { primary, spoken };
}
module.exports = { prepareReply };
