import { demoJourneys, detectClaims, parseCsv } from "./engine.js";
const $ = selector => document.querySelector(selector);
const money = value => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value);
let selectedClaim;

function render(journeys) {
  const claims = detectClaims(journeys);
  const active = claims.filter(claim => claim.status !== "expired");
  $("#total").textContent = money(active.reduce((sum, claim) => sum + claim.amount, 0));
  $("#summary").textContent = `${journeys.length} journeys checked · ${active.length} eligible claims found`;
  $("#next").textContent = active.length ? `${Math.min(...active.map(claim => claim.daysLeft))} days` : "None";
  $("#claims").innerHTML = active.length ? active.map(card).join("") : `<div class="empty">No eligible refunds found in this file.</div>`;
  $("#results").classList.remove("hidden");
  $("#results").scrollIntoView({ behavior: "smooth" });
  document.querySelectorAll("[data-file]").forEach(button => button.onclick = () => openClaim(active.find(claim => claim.id === button.dataset.file)));
}

function card(claim) {
  const delay = claim.type === "delay";
  return `<article class="claim"><div class="claim-icon ${delay ? "yellow" : "blue"}">${delay ? "↘" : "£"}</div><div class="claim-main"><div class="tags"><span>${delay ? "SERVICE DELAY" : "MAXIMUM FARE"}</span><span class="status">READY TO FILE</span></div><h3>${claim.journey.from} <i>→</i> ${claim.journey.to}</h3><p>${claim.journey.date} · ${claim.journey.time}</p>${delay ? `<div class="proof"><span><small>EXPECTED</small><strong>${claim.baseline} min</strong></span><span><small>ACTUAL</small><strong>${claim.actual} min</strong></span><span class="red"><small>DELAY</small><strong>+${claim.delta} min</strong></span><p>Rule applied: ${claim.journey.mode === "tube" ? "Tube" : claim.journey.mode} · ${claim.threshold} minute threshold</p></div>` : `<div class="proof"><span><small>CHARGED</small><strong>${money(claim.journey.charge)}</strong></span><span><small>EXPECTED</small><strong>${money(claim.expectedFare)}</strong></span><p>TfL record: missing touch-out · 48-hour hold complete</p></div>`}</div><div class="claim-action"><strong>${money(claim.amount)}</strong><span>${claim.daysLeft} days left</span><button data-file="${claim.id}">Prepare claim →</button></div></article>`;
}

function openClaim(claim) {
  selectedClaim = claim;
  $("#claim-preview").innerHTML = `<strong>${money(claim.amount)}</strong><span>${claim.journey.from} → ${claim.journey.to}</span>`;
  $("#form-journey").value = `${claim.journey.date}, ${claim.journey.time} — ${claim.journey.description}`;
  $(".confirm").innerHTML = `Confirm & queue claim <span>→</span>`;
  $(".confirm").disabled = false;
  $("#modal").showModal();
}

$("#demo").onclick = () => render(demoJourneys());
$("#file").onchange = async event => { const file = event.target.files[0]; if (file) render(parseCsv(await file.text())); };
$(".close").onclick = () => $("#modal").close();
$(".confirm").onclick = () => {
  if (!selectedClaim) return;
  const cardButton = document.querySelector(`[data-file="${selectedClaim.id}"]`);
  cardButton.textContent = "Queued ✓";
  cardButton.disabled = true;
  const status = cardButton.closest(".claim").querySelector(".status");
  status.textContent = "CLAIM QUEUED";
  status.classList.add("queued");
  $("#modal").close();
  $("#toast").classList.add("show");
  window.setTimeout(() => $("#toast").classList.remove("show"), 4500);
  selectedClaim = undefined;
};
