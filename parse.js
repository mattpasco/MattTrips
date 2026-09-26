/**
 * Parser for a FedEx trip recap page, copied as text (select all, copy, paste).
 * Plain browser script (also runnable under Node via `require`). No dependencies.
 * parseTripPaste(text) returns a trip object, or throws { code } when a part is missing.
 */
(function (global) {
'use strict';

var MON={jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
function pDateParts(s){
  var m=/^(\d{1,2})([A-Za-z]{3})(\d{2})$/.exec((s||'').trim());
  if(!m) return null;
  var mon=MON[m[2].toLowerCase()];
  if(!mon) return null;
  return {y:'20'+m[3], m:mon, d:m[1].length===1?('0'+m[1]):m[1]};
}
function pHM(digits){
  digits=(digits||'').trim();
  if(!digits) return null;
  if(digits.length<=2) return '0:'+(digits.length===1?('0'+digits):digits);
  return digits.slice(0,-2)+':'+digits.slice(-2);
}
function pISOAt(dateStr,timeDigits){
  var dp=pDateParts(dateStr);
  timeDigits=(timeDigits||'').trim();
  if(!dp||!timeDigits) return null;
  var hh,mm;
  if(timeDigits.length<=2){ hh='0'; mm=timeDigits.length===1?('0'+timeDigits):timeDigits; }
  else { hh=timeDigits.slice(0,-2); mm=timeDigits.slice(-2); }
  if(hh.length===1) hh='0'+hh;
  return dp.y+'-'+dp.m+'-'+dp.d+'T'+hh+':'+mm+':00Z';
}
function pAddMinISO(iso,minAdd){
  var d=new Date(new Date(iso).getTime()+minAdd*60000);
  return d.toISOString().slice(0,19)+'Z';
}
function pHMtoMin(hmStr){ var p=hmStr.split(':'); return (+p[0])*60+(+p[1]); }
function pTitleCase(s){ return s.replace(/\S+/g,function(t){return t.charAt(0).toUpperCase()+t.slice(1).toLowerCase();}); }
function pSwapName(s){
  var p=s.trim().split(/\s+/);
  if(p.length===2) return pTitleCase(p[1])+' '+pTitleCase(p[0]);
  return pTitleCase(s);
}

function parseTripPaste(raw){
  var lines=raw.replace(/\r/g,'').split('\n');
  var tripLine=null;
  for(var i=0;i<lines.length;i++){ if(/^Trip\s+\S+\s+[A-Za-z]{3}\s+\S+\s+\d{1,2}[A-Za-z]{3}\d{2}/.test(lines[i].trim())){ tripLine=lines[i].trim(); break; } }
  if(!tripLine) throw {code:'no_trip_line'};
  var th=/^Trip\s+(\S+)\s+([A-Za-z]{3})\s+(\S+)\s+(\d{1,2}[A-Za-z]{3}\d{2})/.exec(tripLine);
  var id=th[1], base=th[2].toUpperCase(), eq=th[3];

  var bpLine=null;
  for(i=0;i<lines.length;i++){ if(/^Block\s+[\d:]+\s+Pay\s+[\d:]+/.test(lines[i].trim())){ bpLine=lines[i].trim(); break; } }
  if(!bpLine) throw {code:'no_block_pay'};
  var bp=/^Block\s+([\d:]+)\s+Pay\s+([\d:]+)/.exec(bpLine);
  var blockTot=bp[1], payTot=bp[2];

  var startIdx=-1, endIdx=-1;
  for(i=0;i<lines.length;i++){
    if(startIdx<0 && /^R\tFlight\tH\tDate/.test(lines[i])) startIdx=i;
    if(endIdx<0 && /T\s*O\s*T\s*A\s*L/.test(lines[i])) endIdx=i;
  }
  if(startIdx<0) throw {code:'no_table'};
  if(endIdx<0) endIdx=lines.length;
  var detailLines=[];
  for(i=startIdx+1;i<endIdx;i++){
    if(lines[i].replace(/\t/g,'').trim().length>0) detailLines.push(lines[i]);
  }

  var items=[]; var lastDest=base; var pending=null;
  function finalizeLayover(gout){
    items.push({t:'l', stn:pending.stn, hotel:pending.hotelName||'Hotel', ph:pending.hotelPhone||pending.gin.ph,
      in:pending.gin.b, out:gout.a, gin:pending.gin, gout:gout});
    pending=null;
  }
  detailLines.forEach(function(line){
    var f=line.split('\t');
    var first=(f[0]||'').trim();
    if(first===''){
      var type=(f[1]||'').trim();
      var date=(f[3]||'').trim();
      var t1=(f[5]||'').trim(), t2=(f[6]||'').trim();
      var combined=(f[7]||'').trim();
      var cm=/^(\+?[\d\-]{7,})\s+(.*)$/.exec(combined);
      var phone=cm?cm[1]:'', name=cm?cm[2].trim():combined;
      if(type==='GT'){
        var gt={co:name, ph:phone, a:pISOAt(date,t1), b:pISOAt(date,t2)};
        if(!pending) pending={stn:lastDest, gin:gt, hotelName:null, hotelPhone:null};
        else finalizeLayover(gt);
      } else if(type==='HOTEL'){
        if(pending){ pending.hotelName=name; pending.hotelPhone=phone; }
      }
    } else {
      var flight=first;
      var hFlag=(f[1]||'').trim();
      var date=(f[2]||'').trim();
      var orgDst=(f[3]||'').trim();
      var dep=(f[5]||'').trim(), arr=(f[6]||'').trim(), blk=(f[7]||'').trim(), turn=(f[8]||'').trim(), lyovr=(f[9]||'').trim(), duty=(f[10]||'').trim();
      var meals=(f[f.length-1]||'').trim();
      var parts=orgDst.split('-');
      if(parts.length<2||!date) return;
      var o=parts[0].trim(), d=parts[1].trim();
      var depISO=pISOAt(date,dep);
      var blkHM=pHM(blk);
      if(!depISO||!blkHM) return;
      var arrISO=pAddMinISO(depISO,pHMtoMin(blkHM));
      var item={t:'f', no:flight, o:o, d:d, s:[depISO,arrISO], blk:[blkHM,blkHM]};
      if(hFlag&&/^[XY]$/i.test(hFlag)) item.dh=true;
      if(turn) item.turn=[pHM(turn),pHM(turn)];
      if(duty) item.duty=[pHM(duty),pHM(duty)];
      if(lyovr) item.lo=[pHM(lyovr),pHM(lyovr)];
      if(meals) item.meals=meals;
      items.push(item);
      lastDest=d;
    }
  });

  var flights=items.filter(function(x){return x.t==='f';});
  if(!flights.length) throw {code:'no_flights'};
  var show=pAddMinISO(flights[0].s[0],-60);
  var end=pAddMinISO(flights[flights.length-1].s[1],30);
  var awayMin=Math.round((Date.parse(end)-Date.parse(show))/60000);
  var awayHM=Math.floor(awayMin/60)+':'+(awayMin%60<10?'0':'')+(awayMin%60);

  var crewStart=-1;
  for(i=0;i<lines.length;i++){ if(/^Pos\tAsg/.test(lines[i])){ crewStart=i; break; } }
  var crew=[];
  if(crewStart>=0){
    for(i=crewStart+1;i<lines.length;i++){
      var l=lines[i];
      if(!l.trim()) break;
      if(/Deadhead Fares/.test(l)) break;
      var f=l.split('\t');
      var seatRaw=(f[0]||'').trim();
      if(!seatRaw) continue;
      var seat=seatRaw==='CAP'?'Captain':(seatRaw==='F/O'?'First officer':seatRaw);
      var empId=(f[3]||'').trim();
      var name=(f[4]||'').trim();
      if(empId&&name) crew.push({seat:seat, code:(f[1]||'').trim(), id:empId, name:pSwapName(name)});
    }
  }

  var fares=[];
  for(i=1;i<lines.length;i++){
    if(/Deadhead Fares/.test(lines[i-1])){
      var f=lines[i].split('\t').map(function(s){return s.trim();}).filter(function(s){return s.length;});
      if(f.length>=4) fares.push({al:f[0], od:f[1], cls:f[2], amt:f[3]});
    }
  }

  return {id:id, base:base, eq:eq, show:show, end:end, away:[awayHM,awayHM], block:[blockTot,blockTot], pay:[payTot,payTot], crew:crew, fares:fares, items:items};
}

global.parseTripPaste = parseTripPaste;
if (typeof module !== 'undefined' && module.exports) module.exports = { parseTripPaste: parseTripPaste };
})(typeof window !== 'undefined' ? window : globalThis);
