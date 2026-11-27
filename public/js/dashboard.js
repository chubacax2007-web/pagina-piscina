lucide.createIcons();

let activeAthlete = "";
let currentUser = null;
let authMode = "welcome";
let allAthletes = [];
let allSessions = [];
let selectedSession = null;

let progressChartInstance = null;
let forceChartInstance = null;
let angleChartInstance = null;

let poolSessionState = { active: false };
let ascendingTimerInterval = null;
let pendingSessionPayload = null;
let batteryAlertShown = false;

function buildJsonHeaders() {
  const csrfMeta = document.querySelector('meta[name="csrf-token"]');
  const headers = { "Content-Type": "application/json" };
  if (csrfMeta) headers["X-CSRF-Token"] = csrfMeta.getAttribute("content");
  return headers;
}

document.addEventListener("DOMContentLoaded", () => {
  const savedUser = localStorage.getItem("sw_user_session");
  if (savedUser) {
    currentUser = JSON.parse(savedUser);
    applyUserData(currentUser);
    document.getElementById("auth-modal").classList.add("hidden");
  }
  loadInitialData();
  setInterval(pollPoolSessionStatus, 2000);
  setInterval(pollSmartwatchLive, 1500);
});

async function loadInitialData() {
  const [athletesRes, sessionsRes] = await Promise.all([
    fetch("/api/athletes"),
    fetch("/api/sessions")
  ]);
  allAthletes = await athletesRes.json();
  allSessions = await sessionsRes.json();

  populateAthleteSelectors();
  await pollPoolSessionStatus();
  await pollSmartwatchLive();
  renderLeaderboard();
  if (currentUser && currentUser.role === "admin") {
    loadAdminOverview();
  }
}

function showNotificationAlert(tag, title, message) {
  const container = document.getElementById("floating-alert-container");
  document.getElementById("alert-tag").textContent = tag;
  document.getElementById("alert-title").textContent = title;
  document.getElementById("alert-message").textContent = message;
  const now = new Date();
  document.getElementById("alert-timestamp").textContent = "Timestamp: " + now.toTimeString().split(" ")[0];
  container.classList.remove("hidden");
  lucide.createIcons();
}

function dismissAlert() {
  document.getElementById("floating-alert-container").classList.add("hidden");
}

function triggerSampleAlert() {
  const session = selectedSession || {
    athlete: activeAthlete || "Mario Peinado",
    elbow_angle: { avg: 84 },
    force_left: { avg: 410 },
    force_right: { avg: 448 }
  };
  showNotificationAlert(
    "ALERTA TÉCNICA & TELEMETRÍA IoT",
    `Umbral Crítico Detectado — ${session.athlete}`,
    `Asimetría de fuerza de tracción detectada (${session.force_left.avg} N Izq vs. ${session.force_right.avg} N Der) y caída de codo en fase de agarre (${session.elbow_angle.avg}° < 86° recomendado).`
  );
}

function resolveTargetSession(sessionId) {
  let target = selectedSession;
  if (sessionId) {
    const found = allSessions.find(s => s.id === sessionId);
    if (found) target = found;
  }
  if (!target) {
    const athleteSessions = allSessions.filter(s => s.athlete === activeAthlete);
    target = athleteSessions[athleteSessions.length - 1] || allSessions[0];
  }
  return target;
}

function exportSessionPdf(sessionId) {
  const targetSession = resolveTargetSession(sessionId);
  if (!targetSession) {
    alert("No hay sesión disponible para exportar.");
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  doc.setFillColor(2, 132, 199);
  doc.rect(0, 0, 210, 34, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text("SWiiTroom - Reporte Biomecanico y Cronometrico", 14, 16);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`Sistema IoT de Evaluacion Tecnica en Natacion | ID Sesion: ${targetSession.id} | Fecha: ${targetSession.date}`, 14, 25);

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("1. Informacion General de la Prueba", 14, 45);

  doc.autoTable({
    startY: 49,
    head: [["Atleta Evaluado", "Estilo Oficial", "Distancia", "Fecha de Registro", "Estado de Validacion"]],
    body: [[
      targetSession.athlete,
      targetSession.style,
      targetSession.distance,
      targetSession.date,
      "Verificado (IMU 9-DoF + Pads FSR)"
    ]],
    theme: "grid",
    headStyles: { fillColor: [3, 105, 161] }
  });

  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("2. Metricas Cronometricas y Cinematicas (Nodos de Contacto FSR)", 14, doc.lastAutoTable.finalY + 12);

  doc.autoTable({
    startY: doc.lastAutoTable.finalY + 16,
    head: [["Tiempo Total (s)", "Parcial 50m (s)", "Tiempo Reaccion (s)", "Tiempo Vuelta (s)", "Velocidad Media", "Frec. Brazada"]],
    body: [[
      `${targetSession.time_sec.toFixed(2)} s`,
      `${targetSession.split_50m.toFixed(2)} s`,
      `${(targetSession.reaction_time || 0.62).toFixed(2)} s`,
      `${(targetSession.turn_time || 1.15).toFixed(2)} s`,
      `${targetSession.speed_ms.toFixed(2)} m/s`,
      `${(targetSession.stroke_rate || 55.4).toFixed(1)} braz/min`
    ]],
    theme: "striped",
    headStyles: { fillColor: [5, 150, 105] }
  });

  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("3. Analisis Biomecanico Articular y Propulsivo (Wearable MPU-9250)", 14, doc.lastAutoTable.finalY + 12);

  const asymmetry = Math.abs(targetSession.force_left.avg - targetSession.force_right.avg);
  const asymmetryPct = ((asymmetry / Math.max(1, targetSession.force_right.avg)) * 100).toFixed(1);

  doc.autoTable({
    startY: doc.lastAutoTable.finalY + 16,
    head: [["Parametro Biomecanico", "Promedio", "Minimo", "Maximo", "Dispersion (IQR)", "Referencia Tecnica"]],
    body: [
      ["Angulo de Codo (Traccion EVF)", `${targetSession.elbow_angle.avg} deg`, `${targetSession.elbow_angle.min} deg`, `${targetSession.elbow_angle.max} deg`, `${targetSession.elbow_angle.iqr} deg`, "Optimo: 85 - 95 deg"],
      ["Angulo de Muneca (Flexion)", `${targetSession.shoulder_angle.avg} deg`, `${targetSession.shoulder_angle.min} deg`, `${targetSession.shoulder_angle.max} deg`, `${targetSession.shoulder_angle.iqr} deg`, "Optimo: 10 - 45 deg"],
      ["Angulos por Fase (Entrada / Traccion / Empuje)", `${targetSession.elbow_angle.phase_entry} deg`, `${targetSession.elbow_angle.phase_pull} deg`, `${targetSession.elbow_angle.phase_push} deg`, "-", "3 Fases de Brazada"],
      ["Fuerza Propulsiva Brazo Izquierdo", `${targetSession.force_left.avg} N`, `${targetSession.force_left.min} N`, `${targetSession.force_left.max} N`, "-", "Filtro IQR Aplicado"],
      ["Fuerza Propulsiva Brazo Derecho", `${targetSession.force_right.avg} N`, `${targetSession.force_right.min} N`, `${targetSession.force_right.max} N`, "-", `Asimetria: ${asymmetryPct}%`]
    ],
    theme: "grid",
    headStyles: { fillColor: [79, 70, 229] }
  });

  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text("4. Diagnostico Tecnico Automatizado:", 14, doc.lastAutoTable.finalY + 12);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  const diagnosisText = `El atleta ${targetSession.athlete} registro una velocidad media de ${targetSession.speed_ms.toFixed(2)} m/s con una frecuencia de ${(targetSession.stroke_rate || 55.4).toFixed(1)} brazadas/min. El tiempo de reaccion en salida fue de ${(targetSession.reaction_time || 0.62).toFixed(2)} s y el viraje en pared de 50m tomo ${(targetSession.turn_time || 1.15).toFixed(2)} s. La traccion de codo promedio (${targetSession.elbow_angle.avg} grados) y el angulo de muneca (${targetSession.shoulder_angle.avg} grados) se mantienen dentro del rango de eficiencia hidrodinamica.`;
  const wrappedDiagnosis = doc.splitTextToSize(diagnosisText, 182);
  doc.text(wrappedDiagnosis, 14, doc.lastAutoTable.finalY + 19);

  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text("Generado automaticamente por la plataforma SWiiTroom IoT - Validacion Experimental", 14, 285);

  doc.save(`Reporte_SWiiTroom_${targetSession.id}_${targetSession.athlete.replace(/\s+/g, "_")}.pdf`);
}

function exportSessionExcelTable(sessionId) {
  const targetSession = resolveTargetSession(sessionId);
  if (!targetSession) {
    alert("No hay sesión disponible para exportar a Excel.");
    return;
  }

  const thinBorder = {
    top: { style: "thin", color: { rgb: "CBD5E1" } },
    bottom: { style: "thin", color: { rgb: "CBD5E1" } },
    left: { style: "thin", color: { rgb: "CBD5E1" } },
    right: { style: "thin", color: { rgb: "CBD5E1" } }
  };

  const bannerTitleStyle = {
    font: { name: "Arial", sz: 14, bold: true, color: { rgb: "FFFFFF" } },
    fill: { fgColor: { rgb: "0284C7" } },
    alignment: { horizontal: "left", vertical: "center" }
  };
  const bannerSubStyle = {
    font: { name: "Arial", sz: 10, italic: true, color: { rgb: "E0F2FE" } },
    fill: { fgColor: { rgb: "0369A1" } },
    alignment: { horizontal: "left", vertical: "center" }
  };
  const sectionTitleStyle = {
    font: { name: "Arial", sz: 11, bold: true, color: { rgb: "0F172A" } },
    fill: { fgColor: { rgb: "E2E8F0" } },
    alignment: { horizontal: "left", vertical: "center" },
    border: thinBorder
  };
  const createHeaderStyle = (hexColor) => ({
    font: { name: "Arial", sz: 10, bold: true, color: { rgb: "FFFFFF" } },
    fill: { fgColor: { rgb: hexColor } },
    alignment: { horizontal: "center", vertical: "center", wrapText: true },
    border: thinBorder
  });
  const createDataStyle = (isEven, isBold = false, align = "center") => ({
    font: { name: "Arial", sz: 10, bold: isBold, color: { rgb: "0F172A" } },
    fill: { fgColor: { rgb: isEven ? "F8FAFC" : "FFFFFF" } },
    alignment: { horizontal: align, vertical: "center", wrapText: true },
    border: thinBorder
  });

  const asymmetry = Math.abs(targetSession.force_left.avg - targetSession.force_right.avg);
  const asymmetryPct = ((asymmetry / Math.max(1, targetSession.force_right.avg)) * 100).toFixed(1);

  const summarySheetRows = [
    ["SWiiTroom - Reporte Biomecánico y Cronométrico (Formato Tabla)", "", "", "", "", ""],
    [`Sistema IoT de Evaluación Técnica en Natación | ID Sesión: ${targetSession.id} | Fecha: ${targetSession.date}`, "", "", "", "", ""],
    ["", "", "", "", "", ""],
    ["1. Información General de la Prueba", "", "", "", "", ""],
    ["Atleta Evaluado", "Estilo Oficial", "Distancia", "Fecha de Registro", "ID Sesión", "Estado de Validación"],
    [targetSession.athlete, targetSession.style, targetSession.distance, targetSession.date, targetSession.id, "Verificado (IMU 9-DoF + Pads FSR)"],
    ["", "", "", "", "", ""],
    ["2. Métricas Cronométricas y Cinemáticas (Nodos de Contacto FSR)", "", "", "", "", ""],
    ["Tiempo Total (s)", "Parcial 50m (s)", "Tiempo Reacción (s)", "Tiempo Vuelta (s)", "Velocidad Media (m/s)", "Frec. Brazada (braz/min)"],
    [
      `${targetSession.time_sec.toFixed(2)} s`,
      `${targetSession.split_50m.toFixed(2)} s`,
      `${(targetSession.reaction_time || 0.62).toFixed(2)} s`,
      `${(targetSession.turn_time || 1.15).toFixed(2)} s`,
      `${targetSession.speed_ms.toFixed(2)} m/s`,
      `${(targetSession.stroke_rate || 55.4).toFixed(1)} spm`
    ],
    ["", "", "", "", "", ""],
    ["3. Análisis Biomecánico Articular y Propulsivo (Wearable MPU-9250)", "", "", "", "", ""],
    ["Parámetro Biomecánico", "Promedio", "Mínimo", "Máximo", "Dispersión (IQR)", "Referencia Técnica"],
    ["Ángulo de Codo (Tracción EVF)", `${targetSession.elbow_angle.avg}°`, `${targetSession.elbow_angle.min}°`, `${targetSession.elbow_angle.max}°`, `${targetSession.elbow_angle.iqr}°`, "Óptimo: 85° - 95°"],
    ["Ángulo de Muñeca (Flexión)", `${targetSession.shoulder_angle.avg}°`, `${targetSession.shoulder_angle.min}°`, `${targetSession.shoulder_angle.max}°`, `${targetSession.shoulder_angle.iqr}°`, "Óptimo: 10° - 45°"],
    ["Ángulos por Fase (Entrada / Tracción / Empuje)", `${targetSession.elbow_angle.phase_entry}°`, `${targetSession.elbow_angle.phase_pull}°`, `${targetSession.elbow_angle.phase_push}°`, "-", "3 Fases de Brazada"],
    ["Fuerza Propulsiva Brazo Izquierdo", `${targetSession.force_left.avg} N`, `${targetSession.force_left.min} N`, `${targetSession.force_left.max} N`, "-", "Filtro IQR Aplicado"],
    ["Fuerza Propulsiva Brazo Derecho", `${targetSession.force_right.avg} N`, `${targetSession.force_right.min} N`, `${targetSession.force_right.max} N`, "-", `Asimetría: ${asymmetryPct}%`],
    ["", "", "", "", "", ""],
    ["4. Diagnóstico Técnico Automatizado", "", "", "", "", ""],
    [`El atleta ${targetSession.athlete} registró una velocidad media de ${targetSession.speed_ms.toFixed(2)} m/s con frecuencia de ${(targetSession.stroke_rate || 55.4).toFixed(1)} braz/min, reacción de ${(targetSession.reaction_time || 0.62).toFixed(2)} s y vuelta de ${(targetSession.turn_time || 1.15).toFixed(2)} s.`, "", "", "", "", ""]
  ];

  const summarySheet = XLSX.utils.aoa_to_sheet(summarySheetRows);
  summarySheet["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 5 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 5 } },
    { s: { r: 3, c: 0 }, e: { r: 3, c: 5 } },
    { s: { r: 7, c: 0 }, e: { r: 7, c: 5 } },
    { s: { r: 11, c: 0 }, e: { r: 11, c: 5 } },
    { s: { r: 19, c: 0 }, e: { r: 19, c: 5 } },
    { s: { r: 20, c: 0 }, e: { r: 20, c: 5 } }
  ];
  summarySheet["!cols"] = [
    { wch: 38 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 20 }, { wch: 28 }
  ];

  for (let col = 0; col <= 5; col++) {
    if (summarySheet[XLSX.utils.encode_cell({ r: 0, c: col })]) summarySheet[XLSX.utils.encode_cell({ r: 0, c: col })].s = bannerTitleStyle;
    if (summarySheet[XLSX.utils.encode_cell({ r: 1, c: col })]) summarySheet[XLSX.utils.encode_cell({ r: 1, c: col })].s = bannerSubStyle;
    [3, 7, 11, 19].forEach(rowIdx => {
      const ref = XLSX.utils.encode_cell({ r: rowIdx, c: col });
      if (summarySheet[ref]) summarySheet[ref].s = sectionTitleStyle;
    });
    if (summarySheet[XLSX.utils.encode_cell({ r: 4, c: col })]) summarySheet[XLSX.utils.encode_cell({ r: 4, c: col })].s = createHeaderStyle("0369A1");
    if (summarySheet[XLSX.utils.encode_cell({ r: 5, c: col })]) summarySheet[XLSX.utils.encode_cell({ r: 5, c: col })].s = createDataStyle(false, col === 0);
    if (summarySheet[XLSX.utils.encode_cell({ r: 8, c: col })]) summarySheet[XLSX.utils.encode_cell({ r: 8, c: col })].s = createHeaderStyle("059669");
    if (summarySheet[XLSX.utils.encode_cell({ r: 9, c: col })]) summarySheet[XLSX.utils.encode_cell({ r: 9, c: col })].s = createDataStyle(true, true);
    if (summarySheet[XLSX.utils.encode_cell({ r: 12, c: col })]) summarySheet[XLSX.utils.encode_cell({ r: 12, c: col })].s = createHeaderStyle("4F46E5");
    for (let row = 13; row <= 17; row++) {
      const ref = XLSX.utils.encode_cell({ r: row, c: col });
      if (summarySheet[ref]) summarySheet[ref].s = createDataStyle(row % 2 === 0, col === 0, col === 0 ? "left" : "center");
    }
    if (summarySheet[XLSX.utils.encode_cell({ r: 20, c: col })]) summarySheet[XLSX.utils.encode_cell({ r: 20, c: col })].s = createDataStyle(false, false, "left");
  }

  const masterHeaders = [
    "ID Sesión", "Atleta Evaluado", "Fecha", "Estilo Oficial", "Distancia (m)",
    "Tiempo Total (s)", "Parcial 50m (s)", "T. Reacción (s)", "T. Vuelta (s)",
    "Velocidad (m/s)", "Frecuencia (spm)", "Codo Prom (°)", "Codo Mín (°)",
    "Codo Máx (°)", "Codo IQR (°)", "Muñeca Prom (°)", "Fuerza Izq (N)", "Fuerza Der (N)"
  ];

  const masterSheetRows = [
    ["SWiiTroom - Tabla General Consolidada de Sesiones Biomecánicas y Cronométricas", ...Array(17).fill("")],
    masterHeaders
  ];

  allSessions.forEach(session => {
    masterSheetRows.push([
      session.id,
      session.athlete,
      session.date,
      session.style,
      session.distance_m,
      Number(session.time_sec.toFixed(2)),
      Number(session.split_50m.toFixed(2)),
      Number((session.reaction_time || 0.62).toFixed(2)),
      Number((session.turn_time || 1.15).toFixed(2)),
      Number(session.speed_ms.toFixed(2)),
      Number((session.stroke_rate || 55.4).toFixed(1)),
      session.elbow_angle.avg,
      session.elbow_angle.min,
      session.elbow_angle.max,
      session.elbow_angle.iqr,
      session.shoulder_angle.avg,
      session.force_left.avg,
      session.force_right.avg
    ]);
  });

  const totalSessions = Math.max(1, allSessions.length);
  const averageColumn = (selector) => Number((allSessions.reduce((acc, s) => acc + selector(s), 0) / totalSessions).toFixed(2));
  masterSheetRows.push([
    "PROMEDIO GENERAL",
    `${allSessions.length} Sesiones`,
    "-",
    "Todos",
    averageColumn(s => s.distance_m || 50),
    averageColumn(s => s.time_sec),
    averageColumn(s => s.split_50m),
    averageColumn(s => s.reaction_time || 0.62),
    averageColumn(s => s.turn_time || 1.15),
    averageColumn(s => s.speed_ms),
    averageColumn(s => s.stroke_rate || 55.4),
    averageColumn(s => s.elbow_angle.avg),
    averageColumn(s => s.elbow_angle.min),
    averageColumn(s => s.elbow_angle.max),
    averageColumn(s => s.elbow_angle.iqr),
    averageColumn(s => s.shoulder_angle.avg),
    averageColumn(s => s.force_left.avg),
    averageColumn(s => s.force_right.avg)
  ]);

  const masterSheet = XLSX.utils.aoa_to_sheet(masterSheetRows);
  masterSheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 17 } }];
  masterSheet["!cols"] = [
    { wch: 16 }, { wch: 20 }, { wch: 13 }, { wch: 16 }, { wch: 14 },
    { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 14 }, { wch: 15 },
    { wch: 16 }, { wch: 14 }, { wch: 13 }, { wch: 13 }, { wch: 13 },
    { wch: 16 }, { wch: 15 }, { wch: 15 }
  ];

  for (let col = 0; col < 18; col++) {
    const topRef = XLSX.utils.encode_cell({ r: 0, c: col });
    if (masterSheet[topRef]) masterSheet[topRef].s = bannerTitleStyle;

    const headerRef = XLSX.utils.encode_cell({ r: 1, c: col });
    if (masterSheet[headerRef]) masterSheet[headerRef].s = createHeaderStyle("0284C7");

    for (let row = 2; row < masterSheetRows.length - 1; row++) {
      const cellRef = XLSX.utils.encode_cell({ r: row, c: col });
      if (masterSheet[cellRef]) {
        masterSheet[cellRef].s = createDataStyle(row % 2 === 0, col === 0, col <= 3 ? "left" : "center");
      }
    }

    const lastRowIdx = masterSheetRows.length - 1;
    const footerRef = XLSX.utils.encode_cell({ r: lastRowIdx, c: col });
    if (masterSheet[footerRef]) {
      masterSheet[footerRef].s = {
        font: { name: "Arial", sz: 10, bold: true, color: { rgb: "0F172A" } },
        fill: { fgColor: { rgb: "E0F2FE" } },
        alignment: { horizontal: col <= 3 ? "left" : "center", vertical: "center" },
        border: thinBorder
      };
    }
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Reporte_Ficha_Tecnica");
  XLSX.utils.book_append_sheet(workbook, masterSheet, "Tabla_General_Sesiones");

  XLSX.writeFile(workbook, `Tabla_SWiiTroom_${targetSession.id}_${targetSession.athlete.replace(/\s+/g, "_")}.xlsx`);
}

async function pollSmartwatchLive() {
  try {
    const response = await fetch("/api/smartwatch/status", { cache: "no-store" });
    const status = await response.json();

    const bannerSwEl = document.getElementById("banner-smartwatch-status");
    const badgeLiveEl = document.getElementById("smartwatch-badge-live");
    const handEl = document.getElementById("sw-live-hand");
    const batteryEl = document.getElementById("sw-live-battery");
    const uptimeEl = document.getElementById("sw-live-uptime");
    const spmEl = document.getElementById("sw-live-spm");

    const padBadgeEl = document.getElementById("pad-live-badge");
    const padForceEl = document.getElementById("pad-live-force-n");
    const padWeightEl = document.getElementById("pad-live-weight-kg");
    const padContactEl = document.getElementById("pad-live-contact");
    const padMetaEl = document.getElementById("pad-live-meta");

    const isPadPacket = status.hand && status.hand.startsWith("PAD_");

    // 1. Live FSR Turn Platform update
    if (status.connected && isPadPacket) {
      const liveForceN = Number(status.force_n || 0);
      const liveWeightKg = liveForceN / 9.81;
      const liveContactSec = Number(status.stroke_rate || status.uptime_sec || 0);

      if (padBadgeEl) {
        padBadgeEl.textContent = "🟢 CONTACTO ACTIVO EN VIVO";
        padBadgeEl.className = "bg-emerald-600 text-white px-3 py-0.5 rounded-full text-[11px] font-black animate-pulse";
      }
      if (padForceEl) padForceEl.textContent = `${liveForceN.toFixed(2)} N`;
      if (padWeightEl) padWeightEl.textContent = `${liveWeightKg.toFixed(2)} kg`;
      if (padContactEl) padContactEl.textContent = `${liveContactSec.toFixed(2)} s`;
      if (padMetaEl) padMetaEl.textContent = `${status.hand}`;

      if (bannerSwEl) {
        bannerSwEl.textContent = `🟢 PAD FSR: ${liveForceN.toFixed(2)} N (${liveWeightKg.toFixed(2)} kg | ${liveContactSec.toFixed(2)} s)`;
        bannerSwEl.className = "text-xs font-black text-emerald-300";
      }
      if (badgeLiveEl) {
        badgeLiveEl.textContent = `● Plataforma FSR Activa (${liveWeightKg.toFixed(2)} kg | ${liveContactSec.toFixed(2)} s)`;
        badgeLiveEl.className = "bg-emerald-100 text-emerald-800 px-3 py-1 rounded-full text-xs font-bold animate-pulse";
      }
      if (handEl) handEl.textContent = status.hand;
      if (uptimeEl) uptimeEl.textContent = `${liveContactSec.toFixed(2)} s`;

      const forceLeft = Number(status.force_left || liveForceN);
      const forceRight = Number(status.force_right || liveForceN);
      document.getElementById("sw-force-avg").textContent = `${forceLeft.toFixed(1)} N / ${forceRight.toFixed(1)} N`;
      document.getElementById("sw-force-disp").textContent = `Plataforma FSR: ${liveForceN.toFixed(2)} N (${liveWeightKg.toFixed(2)} kg)`;
      return;
    } else if ((status.pad_peak && status.pad_peak > 0) || (status.pad_contact_time && status.pad_contact_time > 0)) {
      const lastPeakN = Number(status.pad_peak || 0);
      const lastPeakKg = lastPeakN / 9.81;
      const lastContactSec = Number(status.pad_contact_time || 0);

      if (padBadgeEl) {
        padBadgeEl.textContent = "● Último Viraje Registrado";
        padBadgeEl.className = "bg-white border border-emerald-300 text-emerald-800 px-3 py-0.5 rounded-full text-[11px] font-bold";
      }
      if (padForceEl) padForceEl.textContent = `${lastPeakN.toFixed(2)} N`;
      if (padWeightEl) padWeightEl.textContent = `${lastPeakKg.toFixed(2)} kg`;
      if (padContactEl) padContactEl.textContent = `${lastContactSec.toFixed(2)} s`;
      if (padMetaEl) padMetaEl.textContent = `${status.pad_side || "VUELTA_50M"} • ${status.pad_time || "--:--:--"}`;
    }

    // 2. Live Smartwatch update (ESP32-C3 + MPU-9250)
    if (handEl) handEl.textContent = status.hand;
    if (batteryEl) {
      batteryEl.textContent = `${status.battery}%`;
      batteryEl.className = `text-xs font-black px-3 py-1 rounded-full border bg-white ${status.battery <= 20 ? "text-rose-600 border-rose-300" : "text-emerald-700"}`;
    }
    if (uptimeEl) uptimeEl.textContent = `${status.uptime_sec} s`;
    if (spmEl && status.stroke_rate > 0) {
      spmEl.textContent = `${status.stroke_rate.toFixed(1)} braz/min`;
    }

    if (status.connected && !isPadPacket && status.battery <= 20 && !batteryAlertShown) {
      batteryAlertShown = true;
      showNotificationAlert(
        "ALERTA DE BATERÍA CRÍTICA",
        "Nivel de Batería del Smartwatch ≤ 20%",
        `El wearable reporta ${status.battery}% de carga restante (${status.uptime_sec} s de uso). Se recomienda colocar el reloj en la base de carga Qi.`
      );
    }

    if (status.connected) {
      if (bannerSwEl) {
        bannerSwEl.textContent = `🟢 ${status.hand} (${status.battery}%)`;
        bannerSwEl.className = "text-xs font-black text-emerald-300";
      }
      if (badgeLiveEl) {
        badgeLiveEl.textContent = `● MPU-9250 En Vivo (${status.hand} | Bat: ${status.battery}%)`;
        badgeLiveEl.className = "bg-emerald-100 text-emerald-800 px-3 py-1 rounded-full text-xs font-bold animate-pulse";
      }

      const elbowMin = status.elbow_min || 0;
      const elbowMax = status.elbow_max || 0;
      const elbowIqr = ((elbowMax - elbowMin) * 0.5).toFixed(1);
      document.getElementById("sw-elbow-avg").textContent = `${status.elbow_angle}°`;
      document.getElementById("sw-elbow-disp").textContent = `Mín: ${elbowMin}° | Máx: ${elbowMax}° (IQR: ${elbowIqr}°)`;

      const wristMin = status.shoulder_min || 0;
      const wristMax = status.shoulder_max || 0;
      const wristIqr = ((wristMax - wristMin) * 0.5).toFixed(1);
      document.getElementById("sw-wrist-avg").textContent = `${status.shoulder_angle}°`;
      document.getElementById("sw-wrist-disp").textContent = `Mín: ${wristMin}° | Máx: ${wristMax}° (IQR: ${wristIqr}°)`;

      const forceLeft = status.force_left || status.force_n || 0;
      const forceRight = status.force_right || status.force_n || 0;
      document.getElementById("sw-force-avg").textContent = `${forceLeft} N / ${forceRight} N`;
      document.getElementById("sw-force-disp").textContent = `Lectura dinámica actual: ${status.force_n} N`;

      const phaseEntry = status.phase_entry || 0;
      const phasePull = status.elbow_angle || 0;
      const phasePush = status.phase_push || 0;
      document.getElementById("ref-angle-entry").textContent = `${phaseEntry}°`;
      document.getElementById("ref-angle-pull").textContent = `${phasePull}°`;
      document.getElementById("ref-angle-wrist").textContent = `${status.shoulder_angle}°`;
      document.getElementById("ref-angle-push").textContent = `${phasePush}°`;

      renderSmartwatchCharts(
        [forceLeft, forceLeft, forceLeft, forceLeft, forceLeft, forceLeft],
        [forceRight, forceRight, forceRight, forceRight, forceRight, forceRight],
        [phaseEntry, phasePull, phasePush]
      );
    } else {
      if (bannerSwEl) {
        bannerSwEl.textContent = "⚪ Desconectado / Deep Sleep";
        bannerSwEl.className = "text-xs font-bold text-sky-200";
      }
      if (badgeLiveEl) {
        badgeLiveEl.textContent = "⚪ Smartwatch en Espera / Mostrando Histórico";
        badgeLiveEl.className = "bg-slate-200 text-slate-700 px-3 py-1 rounded-full text-xs font-bold";
      }
    }
  } catch (error) {
    console.warn("[pollSmartwatchLive]", error);
  }
}

function populateAthleteSelectors() {
  const activeSelect = document.getElementById("select-active-athlete");
  const targetSelect = document.getElementById("activity-target-athlete");
  const liveSelect = document.getElementById("live-session-athlete");

  const optionsHtml = allAthletes.length === 0
    ? '<option value="">Sin atletas</option>'
    : allAthletes.map(athlete => `<option value="${athlete.name}">${athlete.name}</option>`).join("");

  if (activeSelect) activeSelect.innerHTML = optionsHtml;
  if (targetSelect) targetSelect.innerHTML = optionsHtml;
  if (liveSelect) liveSelect.innerHTML = optionsHtml;

  if (currentUser && currentUser.role === "athlete") {
    activeAthlete = currentUser.name;
  } else if (allAthletes.length > 0) {
    if (!activeAthlete || !allAthletes.some(a => a.name === activeAthlete)) {
      activeAthlete = allAthletes[0].name;
    }
  }

  if (activeSelect) activeSelect.value = activeAthlete;
  if (targetSelect) targetSelect.value = activeAthlete;
  if (liveSelect) liveSelect.value = activeAthlete;

  updateActiveAthleteData(activeAthlete);
}

function changeActiveAthlete(name) {
  activeAthlete = name;
  const targetSelect = document.getElementById("activity-target-athlete");
  const liveSelect = document.getElementById("live-session-athlete");
  if (targetSelect) targetSelect.value = name;
  if (liveSelect && !poolSessionState.active) liveSelect.value = name;
  updateActiveAthleteData(name);
}

function updateActiveAthleteData(name) {
  document.getElementById("stat-athlete-name").textContent = name || "--";
  document.getElementById("smartwatch-athlete-name").textContent = name || "--";
  document.getElementById("activities-title-label").textContent =
    (currentUser && currentUser.role === "athlete") ? "Mis Rutinas de Referencia" : "Rutinas Asignadas a: " + name;

  applySessionFilters();
  loadAssignedRoutines(name);
}

function applySessionFilters() {
  const styleFilter = document.getElementById("filter-session-style").value;
  const comparisonMode = document.getElementById("filter-comparison-mode").value;

  const athleteSessions = allSessions
    .filter(s => s.athlete === activeAthlete)
    .sort((a, b) => a.date.localeCompare(b.date));

  const totalMeters = athleteSessions.reduce((acc, s) => acc + (s.distance_m || 0), 0);
  const totalSeconds = athleteSessions.reduce((acc, s) => acc + (s.time_sec || 0), 0);
  const avgReaction = athleteSessions.length
    ? athleteSessions.reduce((acc, s) => acc + (s.reaction_time || 0.62), 0) / athleteSessions.length
    : 0;
  const avgTurn = athleteSessions.length
    ? athleteSessions.reduce((acc, s) => acc + (s.turn_time || 1.15), 0) / athleteSessions.length
    : 0;
  const avgStrokeRate = athleteSessions.length
    ? athleteSessions.reduce((acc, s) => acc + (s.stroke_rate || 55.0), 0) / athleteSessions.length
    : 0;

  document.getElementById("stat-distance").textContent = (totalMeters / 1000).toFixed(2) + " km";
  document.getElementById("stat-time").textContent = (totalSeconds / 60).toFixed(1) + " min";
  document.getElementById("stat-reaction").textContent = avgReaction.toFixed(2) + " s";
  document.getElementById("stat-turn").textContent = avgTurn.toFixed(2) + " s";
  document.getElementById("stat-stroke-rate").textContent = avgStrokeRate.toFixed(1) + " spm";

  let filtered = athleteSessions.filter(s => styleFilter === "ALL" || s.style === styleFilter);

  if (comparisonMode === "prev") {
    filtered = filtered.slice(-2);
  } else if (comparisonMode === "last5") {
    filtered = filtered.slice(-5);
  }

  renderSessionsTable(filtered);
  renderComparisonChart(filtered);

  if (filtered.length > 0) {
    inspectSessionDetail(filtered[filtered.length - 1].id);
  } else {
    clearBiomechanicsView();
  }
}

function renderSessionsTable(sessions) {
  const tbody = document.getElementById("sessions-history-tbody");
  if (sessions.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="p-4 text-center text-slate-400">No hay sesiones registradas para ${activeAthlete}.</td></tr>`;
    document.getElementById("comparison-summary-body").innerHTML = "Sin sesiones para comparar.";
    return;
  }

  tbody.innerHTML = sessions.slice().reverse().map(s => `
    <tr class="hover:bg-sky-50/60 transition cursor-pointer" onclick="inspectSessionDetail('${s.id}')">
      <td class="p-3 font-bold text-slate-900">${s.id} <span class="block text-[10px] text-slate-400 font-normal">${s.date}</span></td>
      <td class="p-3 font-bold text-indigo-700">${s.style} <span class="block text-[10px] text-emerald-700">${s.distance}</span></td>
      <td class="p-3 font-mono font-black text-slate-900">${s.time_sec.toFixed(2)} s <span class="block text-[10px] text-sky-700">${s.speed_ms.toFixed(2)} m/s</span></td>
      <td class="p-3 font-mono font-bold text-amber-700">${(s.reaction_time || 0.62).toFixed(2)} s</td>
      <td class="p-3 font-mono font-bold text-rose-700">${(s.turn_time || 1.15).toFixed(2)} s</td>
      <td class="p-3 font-mono font-bold text-emerald-700">${(s.stroke_rate || 55.4).toFixed(1)} spm</td>
      <td class="p-3 font-bold">${s.elbow_angle.avg}° / ${s.shoulder_angle.avg}°</td>
      <td class="p-3 font-bold">${s.force_left.avg}N / ${s.force_right.avg}N</td>
      <td class="p-3 text-right space-x-1 whitespace-nowrap">
        <button onclick="event.stopPropagation(); exportSessionPdf('${s.id}')" class="bg-rose-100 hover:bg-rose-200 text-rose-800 px-2.5 py-1 rounded-lg font-bold text-[11px]">PDF</button>
        <button onclick="event.stopPropagation(); exportSessionExcelTable('${s.id}')" class="bg-emerald-100 hover:bg-emerald-200 text-emerald-800 px-2.5 py-1 rounded-lg font-bold text-[11px]">Excel</button>
      </td>
    </tr>
  `).join("");
}

function inspectSessionDetail(sessionId) {
  const athleteSessions = allSessions
    .filter(s => s.athlete === activeAthlete)
    .sort((a, b) => a.date.localeCompare(b.date));

  const index = athleteSessions.findIndex(s => s.id === sessionId);
  if (index === -1) return;

  const current = athleteSessions[index];
  const previous = index > 0 ? athleteSessions[index - 1] : null;
  selectedSession = current;

  const summaryBody = document.getElementById("comparison-summary-body");
  if (previous) {
    const diffSpeed = (current.speed_ms - previous.speed_ms).toFixed(2);
    const diffReaction = ((current.reaction_time || 0.62) - (previous.reaction_time || 0.62)).toFixed(2);
    const diffTurn = ((current.turn_time || 1.15) - (previous.turn_time || 1.15)).toFixed(2);
    summaryBody.innerHTML = `
      <div class="font-bold text-sky-800">Sesión ${current.id} (${current.date}) vs. ${previous.id}</div>
      <div>• <strong>Prueba:</strong> ${current.style} (${current.distance}) — <strong>${(current.stroke_rate || 55.4).toFixed(1)} spm</strong></div>
      <div>• <strong>Velocidad:</strong> ${current.speed_ms.toFixed(2)} m/s (<span class="${diffSpeed >= 0 ? "text-emerald-600" : "text-rose-600"} font-bold">${diffSpeed >= 0 ? "+" : ""}${diffSpeed} m/s</span>)</div>
      <div>• <strong>T. Reacción / Vuelta:</strong> ${(current.reaction_time || 0.62).toFixed(2)}s (${diffReaction}s) | ${(current.turn_time || 1.15).toFixed(2)}s (${diffTurn}s)</div>
      <div>• <strong>Codo / Muñeca:</strong> ${current.elbow_angle.avg}° / ${current.shoulder_angle.avg}° | Izq ${current.force_left.avg}N - Der ${current.force_right.avg}N</div>
    `;
  } else {
    summaryBody.innerHTML = `
      <div class="font-bold text-sky-800">Sesión ${current.id} (${current.date})</div>
      <div>• <strong>Prueba:</strong> ${current.style} (${current.distance})</div>
      <div>• <strong>T. Reacción:</strong> ${(current.reaction_time || 0.62).toFixed(2)} s | <strong>T. Vuelta:</strong> ${(current.turn_time || 1.15).toFixed(2)} s</div>
      <div>• <strong>Frecuencia:</strong> ${(current.stroke_rate || 55.4).toFixed(1)} braz/min</div>
    `;
  }

  document.getElementById("smartwatch-session-subtitle").textContent =
    `Sesión seleccionada: ${current.id} (${current.date}) — ${current.style} (${current.distance}) | Frecuencia: ${(current.stroke_rate || 55.4).toFixed(1)} spm`;

  document.getElementById("sw-live-spm").textContent = `${(current.stroke_rate || 55.4).toFixed(1)} braz/min`;
  document.getElementById("sw-elbow-avg").textContent = `${current.elbow_angle.avg}°`;
  document.getElementById("sw-elbow-disp").textContent = `Mín: ${current.elbow_angle.min}° | Máx: ${current.elbow_angle.max}° (IQR: ${current.elbow_angle.iqr}°)`;

  document.getElementById("sw-wrist-avg").textContent = `${current.shoulder_angle.avg}°`;
  document.getElementById("sw-wrist-disp").textContent = `Mín: ${current.shoulder_angle.min}° | Máx: ${current.shoulder_angle.max}° (IQR: ${current.shoulder_angle.iqr}°)`;

  document.getElementById("sw-force-avg").textContent = `${current.force_left.avg} N / ${current.force_right.avg} N`;
  document.getElementById("sw-force-disp").textContent = `Rango s/atípicos: ${current.force_left.min}-${current.force_right.max} N`;

  document.getElementById("sw-speed-avg").textContent = `${current.speed_ms.toFixed(2)} m/s`;
  document.getElementById("sw-speed-disp").textContent = `Reacción: ${(current.reaction_time || 0.62).toFixed(2)}s | Vuelta: ${(current.turn_time || 1.15).toFixed(2)}s`;

  document.getElementById("ref-angle-entry").textContent = `${current.elbow_angle.phase_entry}°`;
  document.getElementById("ref-angle-pull").textContent = `${current.elbow_angle.phase_pull}°`;
  document.getElementById("ref-angle-wrist").textContent = `${current.shoulder_angle.avg}°`;
  document.getElementById("ref-angle-push").textContent = `${current.elbow_angle.phase_push}°`;

  renderSmartwatchCharts(
    current.force_left.strokes,
    current.force_right.strokes,
    [current.elbow_angle.phase_entry, current.elbow_angle.phase_pull, current.elbow_angle.phase_push]
  );
}

function clearBiomechanicsView() {
  document.getElementById("sw-elbow-avg").textContent = "0°";
  document.getElementById("sw-wrist-avg").textContent = "0°";
  document.getElementById("sw-force-avg").textContent = "0 N / 0 N";
  document.getElementById("sw-speed-avg").textContent = "0.00 m/s";
  renderSmartwatchCharts([0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], [0, 0, 0]);
}

function renderComparisonChart(sessions) {
  const context = document.getElementById("chartProgressComparison").getContext("2d");
  if (progressChartInstance) progressChartInstance.destroy();

  progressChartInstance = new Chart(context, {
    type: "bar",
    data: {
      labels: sessions.length ? sessions.map(s => `${s.id} (${s.date})`) : ["Sin sesiones"],
      datasets: [
        {
          label: "Frecuencia de Brazada (spm)",
          data: sessions.length ? sessions.map(s => s.stroke_rate || 55) : [0],
          backgroundColor: "#0284c7",
          borderRadius: 6,
          yAxisID: "y"
        },
        {
          label: "Ángulo Codo Promedio (°)",
          data: sessions.length ? sessions.map(s => s.elbow_angle.avg) : [0],
          type: "line",
          borderColor: "#4f46e5",
          backgroundColor: "#4f46e5",
          tension: 0.3,
          yAxisID: "y1"
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { type: "linear", position: "left", title: { display: true, text: "Frec. Brazada (spm)" } },
        y1: { type: "linear", position: "right", title: { display: true, text: "Ángulo Codo (°)" }, grid: { drawOnChartArea: false } }
      }
    }
  });
}

function renderSmartwatchCharts(forceLeft, forceRight, angles) {
  const forceContext = document.getElementById("chartSmartwatchForce").getContext("2d");
  if (forceChartInstance) forceChartInstance.destroy();
  forceChartInstance = new Chart(forceContext, {
    type: "bar",
    data: {
      labels: ["Brazada 1", "Brazada 2", "Brazada 3", "Brazada 4", "Brazada 5", "Brazada 6"],
      datasets: [
        { label: "Brazo Izquierdo (N)", data: forceLeft, backgroundColor: "#0284c7", borderRadius: 4 },
        { label: "Brazo Derecho (N)", data: forceRight, backgroundColor: "#059669", borderRadius: 4 }
      ]
    },
    options: { responsive: true, maintainAspectRatio: false }
  });

  const angleContext = document.getElementById("chartSmartwatchAngle").getContext("2d");
  if (angleChartInstance) angleChartInstance.destroy();
  angleChartInstance = new Chart(angleContext, {
    type: "line",
    data: {
      labels: ["Fase 1 (Entrada)", "Fase 2 (Tracción EVF)", "Fase 3 (Empuje)"],
      datasets: [{
        label: "Ángulo Articular (°)",
        data: angles,
        borderColor: "#6366f1",
        backgroundColor: "rgba(99, 102, 241, 0.12)",
        fill: true,
        tension: 0.3
      }]
    },
    options: { responsive: true, maintainAspectRatio: false }
  });
}

function openConfirmModalFromForm() {
  if (poolSessionState.active) {
    alert("Ya hay una sesión activa en la piscina. Finalízala antes de iniciar otra.");
    return;
  }
  const athlete = document.getElementById("live-session-athlete").value;
  const style = document.getElementById("live-session-style").value;
  const distance = document.getElementById("live-session-distance").value;
  openConfirmModal(athlete, style, distance, "Sesión Directa en Piscina");
}

function openConfirmModalFromRoutine(athlete, style, distance, title) {
  if (poolSessionState.active) {
    alert("Ya hay una sesión activa en la piscina. Finalízala antes de iniciar otra.");
    return;
  }
  openConfirmModal(athlete, style, distance, title);
}

function openConfirmModal(athlete, style, distance, title) {
  pendingSessionPayload = {
    athlete,
    style,
    distance,
    routine_title: title,
    coach: currentUser ? currentUser.name : "Coach"
  };
  document.getElementById("confirm-athlete").textContent = athlete;
  document.getElementById("confirm-style").textContent = style;
  document.getElementById("confirm-distance").textContent = distance;
  document.getElementById("confirm-title").textContent = title;
  const modal = document.getElementById("confirm-session-modal");
  modal.classList.remove("hidden");
  modal.classList.add("flex");
}

function closeConfirmModal() {
  const modal = document.getElementById("confirm-session-modal");
  modal.classList.add("hidden");
  modal.classList.remove("flex");
  pendingSessionPayload = null;
}

async function confirmAndStartPoolSession() {
  if (!pendingSessionPayload) return;
  const response = await fetch("/api/session/start", {
    method: "POST",
    headers: buildJsonHeaders(),
    body: JSON.stringify(pendingSessionPayload)
  });
  const data = await response.json();
  closeConfirmModal();

  if (data.status === "success") {
    await pollPoolSessionStatus();
  } else {
    alert(data.message || "No se pudo iniciar la sesión.");
  }
}

async function finishActivePoolSession() {
  const response = await fetch("/api/session/stop", {
    method: "POST",
    headers: buildJsonHeaders()
  });
  const data = await response.json();
  if (data.status === "success") {
    alert(`Sesión finalizada y guardada para ${data.session.athlete} (${data.session.style} - ${data.session.distance}) en ${data.session.time_sec} s.`);
    const sessionsRes = await fetch("/api/sessions");
    allSessions = await sessionsRes.json();
    await pollPoolSessionStatus();
    updateActiveAthleteData(activeAthlete);
    renderLeaderboard();
  }
}

async function pollPoolSessionStatus() {
  try {
    const response = await fetch("/api/session/status", { cache: "no-store" });
    poolSessionState = await response.json();
    updatePoolSessionUi();
  } catch (error) {
    console.warn("[pollPoolSessionStatus]", error);
  }
}

function updatePoolSessionUi() {
  const dotEl = document.getElementById("live-indicator-dot");
  const statusTextEl = document.getElementById("status-text");
  const metaTextEl = document.getElementById("banner-session-meta");
  const activeBoxEl = document.getElementById("active-session-box");
  const startBtnEl = document.getElementById("btn-open-confirm-session");
  const badgeEl = document.getElementById("pool-control-badge");

  if (poolSessionState.active) {
    dotEl.className = "w-3.5 h-3.5 rounded-full bg-emerald-400 animate-ping";
    statusTextEl.textContent = `🟢 CAPTURANDO EN PISCINA: ${poolSessionState.athlete} (${poolSessionState.routine_title || "Sesión activa"})`;
    metaTextEl.textContent = `${poolSessionState.distance} • ${poolSessionState.style}`;
    if (activeBoxEl) activeBoxEl.classList.remove("hidden");
    if (startBtnEl) {
      startBtnEl.disabled = true;
      startBtnEl.classList.add("opacity-50", "cursor-not-allowed");
    }
    if (badgeEl) {
      badgeEl.textContent = "Sesión en Curso (Bloqueada)";
      badgeEl.className = "bg-amber-100 text-amber-800 px-3 py-1 rounded-full text-xs font-black";
    }
    const infoEl = document.getElementById("active-session-info");
    if (infoEl) {
      infoEl.textContent = `Atleta: ${poolSessionState.athlete} | Estilo: ${poolSessionState.style} | Distancia: ${poolSessionState.distance}`;
    }

    if (!ascendingTimerInterval) {
      ascendingTimerInterval = setInterval(updateAscendingStopwatch, 100);
    }
  } else {
    dotEl.className = "w-3.5 h-3.5 rounded-full bg-amber-400";
    statusTextEl.textContent = "⚪ Sin sesión activa en piscina (Esperando inicio del Coach)";
    metaTextEl.textContent = "--";
    document.getElementById("banner-stopwatch").textContent = "00:00.0";
    const coachTimerEl = document.getElementById("coach-ascending-timer");
    if (coachTimerEl) coachTimerEl.textContent = "00:00.0";
    if (activeBoxEl) activeBoxEl.classList.add("hidden");
    if (startBtnEl) {
      startBtnEl.disabled = false;
      startBtnEl.classList.remove("opacity-50", "cursor-not-allowed");
    }
    if (badgeEl) {
      badgeEl.textContent = "Piscina Libre";
      badgeEl.className = "bg-emerald-100 text-emerald-800 px-3 py-1 rounded-full text-xs font-black";
    }
    if (ascendingTimerInterval) {
      clearInterval(ascendingTimerInterval);
      ascendingTimerInterval = null;
    }
  }
}

function updateAscendingStopwatch() {
  if (!poolSessionState.active || !poolSessionState.start_timestamp) return;
  const elapsedSec = Math.max(0, (Date.now() / 1000) - poolSessionState.start_timestamp);
  const minutes = Math.floor(elapsedSec / 60);
  const seconds = (elapsedSec % 60).toFixed(1);
  const formatted = String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(4, "0");
  document.getElementById("banner-stopwatch").textContent = formatted;
  const coachTimerEl = document.getElementById("coach-ascending-timer");
  if (coachTimerEl) coachTimerEl.textContent = formatted;
}

function publishRoutine() {
  const targetAthlete = document.getElementById("activity-target-athlete").value;
  const style = document.getElementById("activity-style").value;
  const distance = document.getElementById("activity-distance").value;
  const title = document.getElementById("activity-title").value.trim();
  const description = document.getElementById("activity-description").value.trim();

  if (!title || !description || !targetAthlete) {
    alert("Completa el título y las indicaciones técnicas de la rutina.");
    return;
  }

  fetch("/api/activities/add", {
    method: "POST",
    headers: buildJsonHeaders(),
    body: JSON.stringify({
      athlete: targetAthlete,
      style,
      distance,
      title,
      desc: description,
      assigned_by: currentUser ? currentUser.name : "Entrenador"
    })
  }).then(res => res.json()).then(data => {
    if (data.status === "success") {
      document.getElementById("activity-title").value = "";
      document.getElementById("activity-description").value = "";
      loadAssignedRoutines(targetAthlete);
    }
  });
}

function loadAssignedRoutines(athleteName) {
  if (!athleteName) return;
  fetch("/api/activities/" + encodeURIComponent(athleteName))
    .then(res => res.json())
    .then(routines => {
      const isCoachOrAdmin = currentUser && (currentUser.role === "coach" || currentUser.role === "admin");
      const container = document.getElementById("activities-list-container");
      if (routines.length === 0) {
        container.innerHTML = '<div class="text-xs text-slate-400 bg-slate-50 p-4 rounded-xl">No hay rutinas de referencia asignadas para este atleta.</div>';
        return;
      }
      container.innerHTML = routines.map(item => {
        const actionHtml = isCoachOrAdmin
          ? `<button onclick="openConfirmModalFromRoutine('${athleteName}', '${item.style}', '${item.distance}', '${item.title}')" class="bg-emerald-600 hover:bg-emerald-700 text-white font-black px-3.5 py-1.5 rounded-xl text-xs shadow flex items-center gap-1.5">
               <i data-lucide="play" class="w-3.5 h-3.5"></i> Iniciar en Piscina desde esta Rutina
             </button>`
          : `<span class="bg-slate-200 text-slate-700 px-3 py-1 rounded-full font-bold text-[11px]">📋 Referencia de Entrenamiento (Inicio controlado por el Coach)</span>`;

        return `
          <div class="bg-sky-50/70 p-4 rounded-2xl border border-sky-100 text-xs space-y-2">
            <div class="flex flex-wrap justify-between items-center gap-2">
              <span class="font-black text-sky-900 text-sm">${item.title}</span>
              <div class="flex gap-2">
                <span class="bg-indigo-100 text-indigo-800 px-2.5 py-0.5 rounded-full font-bold">🏊‍♂️ ${item.style}</span>
                <span class="bg-emerald-100 text-emerald-800 px-2.5 py-0.5 rounded-full font-bold">📏 ${item.distance}</span>
              </div>
            </div>
            <p class="text-slate-600">${item.desc}</p>
            <div class="flex flex-wrap justify-between items-center pt-2 border-t border-sky-100 gap-2">
              <span class="text-[10px] text-slate-400">Asignada por: ${item.assigned_by} (${item.date || "Hoy"})</span>
              ${actionHtml}
            </div>
          </div>
        `;
      }).join("");
      lucide.createIcons();
    });
}

function renderLeaderboard() {
  const selectedStyle = document.getElementById("rank-filter-style").value;
  const selectedDistance = document.getElementById("rank-filter-distance").value;
  const container = document.getElementById("leaderboard-list-container");

  const matchingSessions = allSessions.filter(s => s.style === selectedStyle && s.distance === selectedDistance);

  const bestByAthlete = {};
  matchingSessions.forEach(session => {
    if (!bestByAthlete[session.athlete] || session.time_sec < bestByAthlete[session.athlete].time_sec) {
      bestByAthlete[session.athlete] = session;
    }
  });

  const ranked = Object.values(bestByAthlete).sort((a, b) => a.time_sec - b.time_sec);

  if (ranked.length === 0) {
    container.innerHTML = `<div class="p-6 text-center text-xs text-slate-400 bg-slate-50 rounded-2xl border">Aún no existen tiempos registrados para <strong>${selectedStyle} — ${selectedDistance}</strong>.</div>`;
    return;
  }

  const medals = ["🥇", "🥈", "🥉"];
  container.innerHTML = ranked.map((item, idx) => `
    <div class="flex items-center justify-between p-3.5 rounded-2xl bg-slate-50 border text-xs">
      <div class="flex items-center gap-3">
        <span class="text-base font-black w-6 text-center">${medals[idx] || (idx + 1) + "º"}</span>
        <div>
          <div class="font-black text-slate-900 text-sm">${item.athlete}</div>
          <div class="text-[10px] text-slate-400 font-semibold">${item.style} • ${item.distance} • Reacción: ${(item.reaction_time || 0.60).toFixed(2)}s • Fecha: ${item.date}</div>
        </div>
      </div>
      <div class="text-right">
        <span class="font-mono text-sky-700 font-black text-sm">${item.time_sec.toFixed(2)} s</span>
        <span class="block text-[10px] text-emerald-700 font-bold">${item.speed_ms.toFixed(2)} m/s (${(item.stroke_rate || 55.4).toFixed(1)} spm)</span>
      </div>
    </div>
  `).join("");
}

function switchAuthMode(mode) {
  authMode = mode;
  document.getElementById("auth-error-box").classList.add("hidden");
  document.getElementById("auth-success-box").classList.add("hidden");

  if (mode === "welcome") {
    document.getElementById("login-screen-welcome").classList.remove("hidden");
    document.getElementById("login-screen-form").classList.add("hidden");
    return;
  }

  document.getElementById("login-screen-welcome").classList.add("hidden");
  document.getElementById("login-screen-form").classList.remove("hidden");

  if (mode === "recover") {
    document.getElementById("form-main-title").textContent = "Recuperación de Cuenta";
    document.getElementById("auth-form").classList.add("hidden");
    document.getElementById("recover-form").classList.remove("hidden");
  } else {
    document.getElementById("auth-form").classList.remove("hidden");
    document.getElementById("recover-form").classList.add("hidden");
    if (mode === "register") {
      document.getElementById("form-main-title").textContent = "Registro de Nuevo Usuario";
      document.getElementById("field-name-container").classList.remove("hidden");
      document.getElementById("forgot-password-link").classList.add("hidden");
      document.getElementById("auth-submit-btn").textContent = "Validar Correo y Crear Cuenta";
    } else {
      document.getElementById("form-main-title").textContent = "Iniciar Sesión";
      document.getElementById("field-name-container").classList.add("hidden");
      document.getElementById("forgot-password-link").classList.remove("hidden");
      document.getElementById("auth-submit-btn").textContent = "Entrar";
    }
  }
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const email = document.getElementById("input-email").value.trim();
  const password = document.getElementById("input-password").value.trim();
  const role = document.getElementById("input-role").value;
  const name = document.getElementById("input-name").value.trim();
  const errorBox = document.getElementById("auth-error-box");
  errorBox.classList.add("hidden");

  const endpoint = authMode === "register" ? "/api/register" : "/api/login";

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: buildJsonHeaders(),
      body: JSON.stringify({ name, email, password, role })
    });
    const result = await response.json();

    if (result.status === "success") {
      localStorage.setItem("sw_user_session", JSON.stringify(result.user));
      location.reload();
    } else {
      errorBox.textContent = result.message || "Credenciales inválidas.";
      errorBox.classList.remove("hidden");
    }
  } catch (error) {
    errorBox.textContent = "Error de conexión con el servidor.";
    errorBox.classList.remove("hidden");
  }
}

async function handleRecoverSubmit(event) {
  event.preventDefault();
  const email = document.getElementById("recover-email").value.trim();
  const newPassword = document.getElementById("recover-new-password").value.trim();
  const errorBox = document.getElementById("auth-error-box");
  const successBox = document.getElementById("auth-success-box");
  errorBox.classList.add("hidden");
  successBox.classList.add("hidden");

  const response = await fetch("/api/recover", {
    method: "POST",
    headers: buildJsonHeaders(),
    body: JSON.stringify({ email, new_password: newPassword })
  });
  const data = await response.json();
  if (data.status === "success") {
    successBox.textContent = data.message;
    successBox.classList.remove("hidden");
  } else {
    errorBox.textContent = data.message;
    errorBox.classList.remove("hidden");
  }
}

function applyUserData(user) {
  const roleLabels = { coach: "Entrenador (Coach)", athlete: "Atleta / Nadador", admin: "Administrador" };
  document.getElementById("nav-username").textContent = user.name;
  document.getElementById("nav-userrole").textContent = roleLabels[user.role] || user.role;
  document.getElementById("profile-name").textContent = user.name;
  document.getElementById("profile-email").textContent = user.email;
  document.getElementById("profile-role-text").textContent = roleLabels[user.role] || user.role;

  const initials = user.name.split(" ").map(part => part[0]).join("").substring(0, 2).toUpperCase();
  document.getElementById("profile-initials").textContent = initials;

  if (user.role === "coach" || user.role === "admin") {
    const selectorContainer = document.getElementById("coach-athlete-selector-container");
    selectorContainer.classList.remove("hidden");
    selectorContainer.classList.add("flex");
    document.getElementById("coach-pool-control-panel").classList.remove("hidden");
    document.getElementById("coach-activity-assignment").classList.remove("hidden");
  } else {
    activeAthlete = user.name;
  }

  if (user.role === "admin") {
    document.getElementById("admin-management-panel").classList.remove("hidden");
  }
}

async function loadAdminOverview() {
  const response = await fetch("/api/admin/users");
  const data = await response.json();
  const container = document.getElementById("admin-users-summary");
  container.innerHTML = `
    <div class="bg-slate-50 p-4 rounded-2xl border">
      <div class="font-black text-indigo-700 uppercase mb-2">Administradores (${data.admins.length})</div>
      ${data.admins.map(u => `<div class="py-1 border-b text-slate-700"><strong>${u.name}</strong><br><span class="text-slate-400">${u.email}</span></div>`).join("")}
    </div>
    <div class="bg-slate-50 p-4 rounded-2xl border">
      <div class="font-black text-sky-700 uppercase mb-2">Coaches (${data.coaches.length})</div>
      ${data.coaches.map(u => `<div class="py-1 border-b text-slate-700"><strong>${u.name}</strong><br><span class="text-slate-400">${u.email}</span></div>`).join("")}
    </div>
    <div class="bg-slate-50 p-4 rounded-2xl border">
      <div class="font-black text-emerald-700 uppercase mb-2">Atletas Registrados (${data.athletes.length})</div>
      ${data.athletes.map(u => `<div class="py-1 border-b text-slate-700"><strong>${u.name}</strong><br><span class="text-slate-400">${u.email}</span></div>`).join("")}
    </div>
  `;
}

function switchTab(tabName) {
  ["progress", "smartwatch", "activities", "profile", "leaderboard"].forEach(tab => {
    document.getElementById("tab-content-" + tab).classList.add("hidden");
    document.getElementById("tab-btn-" + tab).classList.remove("active");
  });
  document.getElementById("tab-content-" + tabName).classList.remove("hidden");
  document.getElementById("tab-btn-" + tabName).classList.add("active");
}

function logout() {
  localStorage.removeItem("sw_user_session");
  location.reload();
}
