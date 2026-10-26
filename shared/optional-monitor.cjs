const {EventEmitter}=require('node:events');
const {HarnessStateMonitor}=require('./harness-state.cjs');
function createOptionalMonitor(settings) {
  const output=new EventEmitter();let active;
  const idle=()=>({state:'idle',label:'待机',connected:false,readTracking:false,source:'本地陪伴',needsReview:false});
  output.snapshot=idle();
  output.start=()=>{output.stop();const config=settings.get();if(!config.followEnabled)return;active=new HarnessStateMonitor(config.harnessHome?{home:config.harnessHome}:{});active.on('change',value=>{output.snapshot=value;output.emit('change',value);});active.start();};
  output.stop=()=>{active?.stop();active=null;output.snapshot=idle();output.emit('change',output.snapshot);};
  output.acknowledge=(...args)=>active?.acknowledge(...args);
  return output;
}
module.exports={createOptionalMonitor};
