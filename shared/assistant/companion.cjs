// No model calls or monitoring of screen/microphone; idle time is supplied by Windows.
function createCompanion({settings,now=()=>new Date(),idle=()=>0,announce=()=>false}){
 let started=now().getTime(),last=started,greeted=false;
 return {tick(){const s=settings(),date=now(),time=date.getTime(),hour=date.getHours();if(!s.companionship)return;
  const quiet=s.quietStart===s.quietEnd?false:s.quietStart<s.quietEnd?hour>=s.quietStart&&hour<s.quietEnd:hour>=s.quietStart||hour<s.quietEnd;
  if(quiet||idle()>300||time-started<60000)return;
  const greeting=s.greeting&&!greeted;if(!greeting&&time-last<s.breakMinutes*60000)return;
  const text=greeting?'老师，今天也一起加油。需要帮忙可以叫我。':'老师，坐了一阵子了。要不要喝点水、活动一下？';
  const spoken=greeting?'先生、今日も一緒に頑張りましょう。':'先生、水を飲んで、少し体を動かしませんか。';
  if(announce({text,spoken,voice:s.voice})){greeted=true;last=time;}
 }};
}
module.exports={createCompanion};
