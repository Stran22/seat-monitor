import { execFileSync } from 'node:child_process';
async function main() {
  const url = new URL(process.env.MONITOR_API_URL || '');
  const key = process.env.MONITOR_API_KEY || '';
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !key) throw Error('configuration');
  const headers = {'X-Monitor-Key':key};
  const get = await fetch(url,{headers,redirect:'error',signal:AbortSignal.timeout(20000)});
  if (!get.ok) throw Error('get_failed');
  const data = await get.json();
  if (!Array.isArray(data.targets) || data.targets.length > 100) throw Error('invalid_targets');
  let updated=0, failed=0, skipped=0;
  for (const target of data.targets) {
    if (Date.parse(target.starts_at) <= Date.now()) {skipped++;continue;}
    try {
      if (!/^\d+$/.test(target.id) || !Number.isSafeInteger(Number(target.id)) || !Number.isSafeInteger(target.expected_total) || target.expected_total < 1) throw Error('invalid_target');
  const output = execFileSync(process.execPath,['src/diagnose.mjs'],{encoding:'utf8',timeout:90000,stdio:['ignore','pipe','pipe'],env:{...process.env,MONITOR_API_KEY:'',MONITOR_API_URL:'',MONITOR_TARGETS_JSON:JSON.stringify([target])}});
  const report = JSON.parse(output);
  const r = report.results?.[0];
  const c = r?.candidate_counts;
  if (r?.id !== target.id || r?.status !== 200 || !r.stable || !r.capacity_match || !c || c.total !== target.expected_total || c.unknown !== 0 || !Number.isSafeInteger(c.free) || !Number.isSafeInteger(c.sold) || c.free < 0 || c.sold < 0 || c.free+c.sold !== c.total) throw Error('unverified_counts');
  const checked = Math.floor(Date.parse(report.checked_at)/1000);
  if (!Number.isSafeInteger(checked)) throw Error('invalid_timestamp');
  const post = await fetch(url,{method:'POST',headers:{...headers,'Content-Type':'application/json'},redirect:'error',signal:AbortSignal.timeout(20000),body:JSON.stringify({results:[{id:Number(target.id),url:target.url,starts_at:target.starts_at,free:c.free,sold:c.sold,checked_at:checked}]})});
  if (!post.ok) throw Error('write_failed');
  const result = await post.json();
      if (result.updated===1) updated++; else if(result.skipped===1) skipped++; else throw Error('invalid_response');
    } catch { failed++; }
    console.log(JSON.stringify({processed:updated+failed+skipped,updated,failed,skipped}));
  }
  console.log(JSON.stringify({targets_received:data.targets.length,updated,failed,skipped,result:failed?'partial_failure':'batch_complete'}));
  if(failed) process.exitCode=1;
}
main().catch(()=>{console.log(JSON.stringify({result:'batch_failed'}));process.exitCode=1;});
