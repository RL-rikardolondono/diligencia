// Generado desde la app: calendario judicial colombiano (mismas reglas que la pantalla)
// ---------- utilidades ----------
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>Math.random().toString(36).slice(2,9)+Date.now().toString(36).slice(-3);
const pad=n=>String(n).padStart(2,'0');
const ymd=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const pd=s=>{if(!s)return null;const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d)};
const HOY=ymd(new Date());
const addD=(s,n)=>{const d=pd(s);d.setDate(d.getDate()+n);return ymd(d)};
const diffD=(a,b)=>Math.round((pd(b)-pd(a))/864e5); // b - a
const MESES=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const MES3=['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];
const DIAS=['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
const fLarga=s=>{if(!s)return '';const d=pd(s);return d.getDate()+' de '+MESES[d.getMonth()]+' de '+d.getFullYear()};
const fCorta=s=>{if(!s)return '—';const d=pd(s);return pad(d.getDate())+'/'+pad(d.getMonth()+1)+'/'+d.getFullYear()};
const fDia=s=>{const d=pd(s);return DIAS[d.getDay()]+' '+d.getDate()+' '+MES3[d.getMonth()].toLowerCase()};
const cop=n=>'$'+Math.round(Number(n)||0).toLocaleString('es-CO');
const num=v=>Number(String(v).replace(/[^\d.-]/g,''))||0;

// ---------- calendario judicial colombiano ----------
function pascua(y){const a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),mes=Math.floor((h+l-7*m+114)/31),dia=((h+l-7*m+114)%31)+1;return new Date(y,mes-1,dia)}
const _fest={};
function festivos(y){ // Ley 51 de 1983 (Ley Emiliani)
  if(_fest[y])return _fest[y];
  const r={};const fijo=(m,d,n)=>r[ymd(new Date(y,m-1,d))]=n;
  const lunes=(m,d,n)=>{const x=new Date(y,m-1,d);const w=x.getDay();if(w!==1)x.setDate(x.getDate()+((8-w)%7));r[ymd(x)]=n};
  const p=pascua(y);const rel=(n,t)=>{const x=new Date(p);x.setDate(x.getDate()+n);r[ymd(x)]=t};
  fijo(1,1,'Año Nuevo');fijo(5,1,'Día del Trabajo');fijo(7,20,'Independencia');fijo(8,7,'Batalla de Boyacá');fijo(12,8,'Inmaculada Concepción');fijo(12,25,'Navidad');
  lunes(1,6,'Reyes Magos');lunes(3,19,'San José');lunes(6,29,'San Pedro y San Pablo');lunes(8,15,'Asunción de la Virgen');lunes(10,12,'Día de la Raza');lunes(11,1,'Todos los Santos');lunes(11,11,'Independencia de Cartagena');
  rel(-3,'Jueves Santo');rel(-2,'Viernes Santo');rel(43,'Ascensión del Señor');rel(64,'Corpus Christi');rel(71,'Sagrado Corazón');
  return _fest[y]=r;
}
function semanaSanta(y){const p=pascua(y);return [-6,-5,-4].map(n=>{const x=new Date(p);x.setDate(x.getDate()+n);return ymd(x)})}
function enVacancia(s){const d=pd(s);const m=d.getMonth()+1,dd=d.getDate();return (m===12&&dd>=20)||(m===1&&dd<=10)}
function motivoInhabil(s,opt){ // opt: {vacancia,semanaSanta,cierres[]}
  const d=pd(s);const w=d.getDay();
  if(w===0)return 'Domingo'; if(w===6)return 'Sábado';
  const f=festivos(d.getFullYear())[s]; if(f)return 'Festivo: '+f;
  if(opt.vacancia&&enVacancia(s))return 'Vacancia judicial (20 dic – 10 ene)';
  if(opt.semanaSanta&&semanaSanta(d.getFullYear()).includes(s))return 'Semana Santa (despachos cerrados)';
  const c=(opt.cierres||[]).find(x=>x.fecha===s); if(c)return 'Cierre: '+c.motivo;
  return '';
}
const habil=(s,opt)=>!motivoInhabil(s,opt);
function sigHabil(s,opt){let x=s;while(!habil(x,opt))x=addD(x,1);return x}
function sumarHabiles(s,n,opt){let x=s,c=0;while(c<n){x=addD(x,1);if(habil(x,opt))c++}return x}
function habilesEntre(a,b,opt){ // días hábiles desde a (excl.) hasta b (incl.); negativo si b<a
  if(a===b)return 0; let c=0; if(b>a){let x=a;while(x<b){x=addD(x,1);if(habil(x,opt))c++}return c}
  let x=b;while(x<a){x=addD(x,1);if(habil(x,opt))c++}return -c;
}
// Cómputo de términos: CGP art. 118 y Ley 2213 de 2022 art. 8
function calcularTermino({fecha,cantidad,unidad,ley2213,opt}){
  const pasos=[];let base=fecha;
  if(ley2213){base=sumarHabiles(fecha,2,opt);pasos.push('Envío del mensaje de datos: '+fLarga(fecha)+'. La notificación se entiende surtida al terminar 2 días hábiles: '+fLarga(base)+' (Ley 2213/2022, art. 8).')}
  else pasos.push('Fecha de notificación o de la providencia: '+fLarga(fecha)+'.');
  let venc;
  if(unidad==='h'){venc=sumarHabiles(base,cantidad,opt);pasos.push('El término corre desde el día hábil siguiente ('+fLarga(sumarHabiles(base,1,opt))+') y se cuentan '+cantidad+' días hábiles, sin sábados, domingos, festivos'+(opt.vacancia?', vacancia judicial':'')+(opt.semanaSanta?', Semana Santa':'')+' ni cierres registrados (CGP art. 118).')}
  else{
    const d=pd(base);
    if(unidad==='c')d.setDate(d.getDate()+cantidad); else if(unidad==='m')d.setMonth(d.getMonth()+cantidad); else d.setFullYear(d.getFullYear()+cantidad);
    venc=ymd(d);pasos.push('Término en '+({c:'días calendario',m:'meses',a:'años'})[unidad]+': se cuenta conforme al calendario hasta '+fLarga(venc)+'.');
    const m=motivoInhabil(venc,opt);
    if(m){const v2=sigHabil(venc,opt);pasos.push('Ese día es inhábil ('+m+'); el vencimiento se traslada al primer día hábil siguiente: '+fLarga(v2)+' (CGP art. 118, inc. final).');venc=v2}
  }
  return {venc,pasos};
}

module.exports={HOY:()=>ymd(new Date(new Date().toLocaleString("en-US",{timeZone:"America/Bogota"}))),ymd,addD,fLarga,fCorta,fDia,cop,motivoInhabil,habilesEntre,festivos,calcularTermino};
