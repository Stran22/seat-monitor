async function main() {
  const url = new URL(process.env.MONITOR_API_URL || '');
  const key = process.env.MONITOR_API_KEY || '';
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !key) throw new Error('configuration');
  const response = await fetch(url, {headers: {'X-Monitor-Key': key}, redirect: 'error', signal: AbortSignal.timeout(20000)});
  if (!response.ok) { console.log(JSON.stringify({http:response.status, result:'api_failed'})); process.exitCode=1; return; }
  const data = await response.json();
  if (!Array.isArray(data.targets) || !data.targets.every(t => typeof t.id === 'string' && /^\d+$/.test(t.id) && typeof t.url === 'string' && Number.isFinite(Date.parse(t.starts_at)) && Number.isSafeInteger(t.expected_total) && t.expected_total > 0)) throw new Error('invalid_targets');
  console.log(JSON.stringify({http:response.status, targets_received:data.targets.length, valid_structure:true, db_writes:0, result:'api_ready'}));
}
main().catch(() => { console.log(JSON.stringify({result:'api_check_failed'})); process.exitCode=1; });
