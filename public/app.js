import { analyseWithTfl, demoJourneys, detectClaims, parseCsv } from "./engine.js";
const $ = selector => document.querySelector(selector);
const money = value => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value);
const esc = value => String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
let selectedClaim;

function render(journeys, tflResult) {
  const claims = tflResult?.claims || detectClaims(journeys);
  const active = claims.filter(claim => claim.status !== "expired");
  $("#total").textContent = money(active.reduce((sum, claim) => sum + claim.amount, 0));
  $("#summary").textContent = `${journeys.length} journeys checked · ${active.length} eligible claims found`;
  $("#next").textContent = active.length ? `${Math.min(...active.map(claim => claim.daysLeft))} days` : "None";
  $("#claims").innerHTML = active.length ? active.map(card).join("") : `<div class="empty">No eligible refunds found in this file.</div>`;
  $("#audit").innerHTML = tflResult ? `<h3>Journey analysis</h3>${tflResult.analyses.map(auditRow).join("")}` : "";
  $("#results").classList.remove("hidden");
  $("#results").scrollIntoView({ behavior: "smooth" });
  document.querySelectorAll("[data-file]").forEach(button => button.onclick = () => openClaim(active.find(claim => claim.id === button.dataset.file)));
}

function card(claim) {
  const delay = claim.type === "delay";
  return `<article class="claim"><div class="claim-icon ${delay ? "yellow" : "blue"}">${delay ? "↘" : "£"}</div><div class="claim-main"><div class="tags"><span>${delay ? "POTENTIAL REFUND" : "MAXIMUM FARE"}</span><span class="status">READY TO REVIEW</span></div><h3>${esc(claim.journey.from)} <i>→</i> ${esc(claim.journey.to)}</h3><p>${esc(claim.journey.date)} · ${esc(claim.journey.time)}</p>${delay ? `<div class="proof"><span><small>EXPECTED</small><strong>${claim.baseline} min</strong></span><span><small>ACTUAL</small><strong>${claim.actual} min</strong></span><span class="red"><small>DELAY</small><strong>+${claim.delta} min</strong></span><p>${esc(claim.baselineSource || "Personal median")} · ${claim.threshold} minute ${esc(claim.journey.mode)} threshold</p></div>` : `<div class="proof"><span><small>CHARGED</small><strong>${money(claim.journey.charge)}</strong></span><span><small>EXPECTED</small><strong>${money(claim.expectedFare)}</strong></span><p>TfL record: missing touch-out · 48-hour hold complete</p></div>`}</div><div class="claim-action"><strong>${money(claim.amount)}</strong><span>${claim.daysLeft} days left</span><button data-file="${claim.id}">Prepare claim →</button></div></article>`;
}

function auditRow(analysis) {
  const checked = ["candidate", "not-eligible"].includes(analysis.status);
  const result = analysis.status === "candidate" ? "Potential refund" : analysis.status === "not-eligible" ? `Not eligible · ${analysis.delta} min delay` : analysis.reason;
  return `<div class="audit-row"><div><strong>${esc(analysis.journey.from)} → ${esc(analysis.journey.to)}</strong><span>${esc(analysis.journey.date)} · ${esc(analysis.journey.time)}</span></div><div>${checked ? `<span>TfL baseline ${analysis.baseline} min · actual ${analysis.actual} min</span><small>${esc(analysis.lines?.join(", ") || analysis.source)}</small>` : ""}</div><b class="audit-${esc(analysis.status)}">${esc(result)}</b></div>`;
}

function openClaim(claim) {
  selectedClaim = claim;
  $("#claim-preview").innerHTML = `<strong>${money(claim.amount)}</strong><span>${esc(claim.journey.from)} → ${esc(claim.journey.to)}</span>`;
  $("#form-journey").value = `${claim.journey.date}, ${claim.journey.time} — ${claim.journey.description}`;
  $("#form-reason").value = claim.type === "delay"
    ? `My journey took ${claim.actual} minutes compared with my ${claim.baseline}-minute personal route baseline, a delay of ${claim.delta} minutes. This exceeds the ${claim.threshold}-minute ${claim.journey.mode} refund threshold.`
    : `This journey has no recorded touch-out. I was charged ${money(claim.journey.charge)} instead of the expected ${money(claim.expectedFare)} fare, a difference of ${money(claim.amount)}.`;
  $(".confirm").innerHTML = `Copy details & open TfL <span>↗</span>`;
  $(".confirm").disabled = false;
  $("#modal").showModal();
}

function claimText(claim) {
  return `TfL refund claim\nJourney: ${claim.journey.date}, ${claim.journey.time} — ${claim.journey.description}\nAmount: ${money(claim.amount)}\nReason: ${$("#form-reason").value}`;
}

$("#demo").onclick = () => render(demoJourneys());
$("#connect-tfl").onclick = () => $("#connect-dialog").showModal();
$(".connect-close").onclick = () => $("#connect-dialog").close();
$("#start-connect").onclick = async () => {
  const button = $("#start-connect");
  button.disabled = true;
  $("#connect-status").textContent = "Starting your private browser…";
  try {
    const response = await fetch("/api/browserbase/connect", {
      method: "POST",
      headers: { "content-type": "application/json", "x-connect-token": $("#connect-token").value },
      body: JSON.stringify({ contextId: localStorage.getItem("reclaim_tfl_context") }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Connection failed");
    localStorage.setItem("reclaim_tfl_context", result.contextId);
    $("#connect-status").innerHTML = `<b>Secure browser ready.</b> Sign into TfL, complete SMS verification, then leave the browser open.`;
    $("#tfl-live").src = result.liveUrl;
    $("#tfl-live").hidden = false;
    $("#connect-start").hidden = true;
  } catch (error) {
    $("#connect-status").textContent = error.message;
    button.disabled = false;
  }
};
$("#file").onchange = async event => {
  const file = event.target.files[0];
  if (!file) return;
  const journeys = parseCsv(await file.text());
  $("#results").classList.remove("hidden");
  $("#claims").innerHTML = `<div class="empty">Checking ${journeys.length} journeys against TfL…</div>`;
  $("#audit").innerHTML = "";
  try { render(journeys, await analyseWithTfl(journeys)); }
  catch (error) { $("#claims").innerHTML = `<div class="empty">TfL analysis failed: ${esc(error.message)}</div>`; }
};
$(".close").onclick = () => $("#modal").close();
$(".confirm").onclick = async () => {
  if (!selectedClaim) return;
  window.open("https://tfl.gov.uk/fares/refunds-and-replacements", "_blank", "noopener,noreferrer");
  try {
    await navigator.clipboard.writeText(claimText(selectedClaim));
  } catch {
    const text = document.createElement("textarea");
    text.value = claimText(selectedClaim);
    document.body.append(text);
    text.select();
    document.execCommand("copy");
    text.remove();
  }
  const cardButton = document.querySelector(`[data-file="${selectedClaim.id}"]`);
  cardButton.textContent = "Copied & opened ✓";
  cardButton.disabled = true;
  window.setTimeout(() => {
    cardButton.textContent = "Prepare claim →";
    cardButton.disabled = false;
  }, 2500);
  $("#modal").close();
  $("#toast b").textContent = "Claim details copied";
  $("#toast span").textContent = "Paste them into the TfL refund form opened in the new tab.";
  $("#toast").classList.add("show");
  window.setTimeout(() => $("#toast").classList.remove("show"), 4500);
};
