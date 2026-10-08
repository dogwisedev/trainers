// Regenerates seed.sql from lib/demo-seed.json (the import from the Bookings + Availability sheet).
import fs from "node:fs";
const seed = JSON.parse(fs.readFileSync(new URL("../lib/demo-seed.json", import.meta.url)));
const q = (v) => v === null || v === undefined || v === "" ? "null" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
const arr = (a) => a && a.length ? `array[${a.map(q).join(",")}]::text[]` : "'{}'::text[]";
const out = ["-- DogwiseTrainers seed: imported from the Bookings + Availability sheet on " + seed.generated, "begin;"];
const TCOLS = ["id","name","email","work_email","dogwise_email","phone","address","city","state","zip","lat","lon","range_text","range_miles","capacity","monthly_capacity","programs","offering","notes","poc","shirt_size","second_location","local_vet","emergency_vet","emergency_contact","birthday","bio","active"];
for (const t of seed.trainers) {
  out.push(`insert into trainers (${TCOLS.join(",")},data_flags) values (${TCOLS.map(c => c === "active" ? (t.active ? "true" : "false") : q(t[c])).join(",")},${arr(t.data_flags)}) on conflict (id) do nothing;`);
}
for (const b of seed.bookings) {
  out.push(`insert into bookings (id,trainer_id,client_name,dog_name,program,start_date,end_date,weeks,status,sheet_color) values (${[b.id,b.trainer_id,b.client_name,b.dog_name,`${b.weeks}-week`,b.start_date,b.end_date].map(q).join(",")},${b.weeks},${q(b.status)},${q(b.sheet_color)}) on conflict (id) do nothing;`);
}
for (const o of seed.time_off) {
  out.push(`insert into time_off (id,trainer_id,start_date,end_date,slots_blocked,reason,note) values (${[o.id,o.trainer_id,o.start_date,o.end_date].map(q).join(",")},${o.slots_blocked ?? "null"},${q(o.reason)},${q(o.note)}) on conflict (id) do nothing;`);
}
out.push("commit;");
fs.writeFileSync(new URL("./seed.sql", import.meta.url), out.join("\n") + "\n");
console.log(`seed.sql: ${seed.trainers.length} trainers, ${seed.bookings.length} bookings, ${seed.time_off.length} time off`);
