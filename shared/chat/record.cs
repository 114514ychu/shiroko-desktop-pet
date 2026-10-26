using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

// A recording belongs to one explicit microphone request and never touches disk.
public sealed class PetMicrophone : IDisposable {
 [StructLayout(LayoutKind.Sequential)] struct Format { public ushort tag,channels;public uint rate,bytesPerSecond;public ushort align,bits,extra; }
 [StructLayout(LayoutKind.Sequential)] struct Header { public IntPtr data;public uint size,recorded;public UIntPtr user;public uint flags,loops;public IntPtr next;public UIntPtr reserved; }
 delegate void Callback(IntPtr input,uint message,UIntPtr instance,IntPtr header,IntPtr reserved);
 [DllImport("winmm.dll")] static extern int waveInOpen(out IntPtr input,uint device,ref Format format,Callback callback,UIntPtr instance,uint flags);
 [DllImport("winmm.dll")] static extern int waveInPrepareHeader(IntPtr input,IntPtr header,uint size);
 [DllImport("winmm.dll")] static extern int waveInAddBuffer(IntPtr input,IntPtr header,uint size);
 [DllImport("winmm.dll")] static extern int waveInStart(IntPtr input);
 [DllImport("winmm.dll")] static extern int waveInReset(IntPtr input);
 [DllImport("winmm.dll")] static extern int waveInUnprepareHeader(IntPtr input,IntPtr header,uint size);
 [DllImport("winmm.dll")] static extern int waveInClose(IntPtr input);
 readonly object gate=new object();readonly MemoryStream audio=new MemoryStream();
 readonly IntPtr[] headers=new IntPtr[4],buffers=new IntPtr[4];
 readonly Callback callback;IntPtr input;bool running;volatile bool finishRequested;int voiced;DateTime lastVoice;double peak;
 static readonly uint headerSize=(uint)Marshal.SizeOf(typeof(Header));
 public PetMicrophone(){callback=OnAudio;}
 public void Finish(){finishRequested=true;}
 public void ListenForFinish(){
  var thread=new Thread(delegate(){try{if(Console.ReadLine()=="finish")Finish();}catch{}});
  thread.IsBackground=true;thread.Start();
 }
 static void Check(int code){if(code!=0)throw new Exception("Cannot open microphone (Windows audio error "+code+").");}
 void OnAudio(IntPtr handle,uint message,UIntPtr instance,IntPtr address,IntPtr unused){
  if(message!=0x3C0)return;
  lock(gate){
   if(!running)return;
   var h=(Header)Marshal.PtrToStructure(address,typeof(Header));
   var bytes=new byte[h.recorded];Marshal.Copy(h.data,bytes,0,bytes.Length);
   // A hard cap also protects against a misbehaving driver.
   if(audio.Length+bytes.Length<=16000*2*21)audio.Write(bytes,0,bytes.Length);
   double squares=0;for(int i=0;i+1<bytes.Length;i+=2){double n=(short)(bytes[i]|(bytes[i+1]<<8))/32768.0;squares+=n*n;}
   double rms=Math.Sqrt(squares/Math.Max(1,bytes.Length/2));peak=Math.Max(peak,rms);
   if(rms>0.008){voiced++;lastVoice=DateTime.UtcNow;}
   waveInAddBuffer(input,address,headerSize);
  }
 }
 public byte[] Record(){
  var format=new Format{tag=1,channels=1,rate=16000,bytesPerSecond=32000,align=2,bits=16,extra=0};
  Check(waveInOpen(out input,0xffffffff,ref format,callback,UIntPtr.Zero,0x30000));
  for(int i=0;i<headers.Length;i++){
   buffers[i]=Marshal.AllocHGlobal(3200);headers[i]=Marshal.AllocHGlobal((int)headerSize);
   Marshal.StructureToPtr(new Header{data=buffers[i],size=3200},headers[i],false);
   Check(waveInPrepareHeader(input,headers[i],headerSize));Check(waveInAddBuffer(input,headers[i],headerSize));
  }
  running=true;lastVoice=DateTime.UtcNow;Check(waveInStart(input));
  Console.WriteLine("{\"ready\":true}");
  DateTime start=DateTime.UtcNow;
  while(!finishRequested&&(DateTime.UtcNow-start).TotalSeconds<20){
   Thread.Sleep(50);
   lock(gate){if(voiced>=3&&(DateTime.UtcNow-lastVoice).TotalSeconds>1.1)break;}
  }
  lock(gate){running=false;}
  waveInReset(input);
  if(voiced<3&&(!finishRequested||audio.Length<6400||peak<0.001))throw new Exception(peak<0.001?"Microphone received no signal. Check headset hardware mute and Windows recording device.":"No clear speech detected. Move closer to the microphone and try again.");
  return audio.ToArray();
 }
 public void Dispose(){
  lock(gate){running=false;}
  if(input!=IntPtr.Zero){waveInReset(input);for(int i=0;i<headers.Length;i++)if(headers[i]!=IntPtr.Zero)waveInUnprepareHeader(input,headers[i],headerSize);waveInClose(input);input=IntPtr.Zero;}
  for(int i=0;i<headers.Length;i++){if(headers[i]!=IntPtr.Zero)Marshal.FreeHGlobal(headers[i]);if(buffers[i]!=IntPtr.Zero)Marshal.FreeHGlobal(buffers[i]);headers[i]=buffers[i]=IntPtr.Zero;}
  audio.Dispose();GC.KeepAlive(callback);
 }
}
