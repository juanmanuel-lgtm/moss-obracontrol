/********************************************************************
 * MOSS ObraControl — Módulo CRM v31-playbook (BACKEND)
 * Pegar este código COMPLETO al final del Apps Script existente
 * (proyecto MOSS BBDD OBRAS 2026). No borra nada de lo actual.
 *
 * Integración con los handlers existentes:
 *  - En doGet(e):  agregar al inicio:
 *      if (e.parameter.action === 'crm') return crmGet();
 *  - En doPost(e): agregar al inicio (tras parsear el body):
 *      if (data.action === 'crm.guardar') return crmGuardar(data.payload);
 ********************************************************************/

var CRM_SHEET_ID = '1kQZbimtPYBN9O-RDsAIoAQSsuiXxP8btdrGlHdXC7NU'; // leads chatbot
var CRM_TAB_SEG  = 'CRM_SEGUIMIENTO';

// Columnas de la pestaña CRM_SEGUIMIENTO (se crea sola si no existe)
var CRM_COLS = ['id','stage','resultado','nota','proxContacto','intentos',
  'presupuestoCliente','valorCotizado','valorCerrado','m2','responsable',
  'fase1Agendada','fechaCierre','anticipoOK','clasificacion','fechaUpdate','historial'];

function crmGet() {
  var ss = SpreadsheetApp.openById(CRM_SHEET_ID);

  // 1) Leads crudos del chatbot (primera pestaña)
  var hojaLeads = ss.getSheets()[0];
  var vals = hojaLeads.getDataRange().getValues();
  var leads = [];
  for (var i = 1; i < vals.length; i++) {
    var r = vals[i];
    var id = String(r[0] || '').trim();
    var nombre = String(r[1] || '').trim();
    var contacto = String(r[15] || '').trim();
    if (!id || !nombre) continue;            // fila vacía
    if (!contacto && id.length < 7) continue; // basura
    leads.push({
      id: id,
      nombre: nombre,
      ciudad: String(r[2]||'').trim(),
      proyecto: String(r[3]||'').trim(),
      tipo: String(r[4]||'').trim(),
      espacios: String(r[5]||'').trim(),
      m2: String(r[6]||'').trim(),
      acabado: String(r[7]||'').trim(),
      cumplePresupuesto: String(r[9]||'').trim(),
      tiempoInicio: String(r[10]||'').trim(),
      contacto: contacto,
      fecha: (r[16] instanceof Date) ? Utilities.formatDate(r[16],'America/Bogota','yyyy-MM-dd') : String(r[16]||'').trim(),
      campana: String(r[18]||'').trim()
    });
  }

  // 2) Seguimiento (pestaña CRM_SEGUIMIENTO)
  var seg = {};
  var hojaSeg = ss.getSheetByName(CRM_TAB_SEG);
  if (hojaSeg && hojaSeg.getLastRow() > 1) {
    var sv = hojaSeg.getDataRange().getValues();
    for (var j = 1; j < sv.length; j++) {
      var o = {};
      for (var c = 0; c < CRM_COLS.length; c++) o[CRM_COLS[c]] = sv[j][c];
      if (o.historial) { try { o.historial = JSON.parse(o.historial); } catch(e) { o.historial = []; } }
      else o.historial = [];
      if (o.proxContacto instanceof Date) o.proxContacto = Utilities.formatDate(o.proxContacto,'America/Bogota','yyyy-MM-dd');
      seg[String(o.id)] = o;
    }
  }

  return ContentService
    .createTextOutput(JSON.stringify({ ok:true, leads:leads, seguimiento:seg }))
    .setMimeType(ContentService.MimeType.JSON);
}

function crmGuardar(payload) {
  // payload = { "<idLead>": {stage,resultado,nota,proxContacto,...}, ... }
  var ss = SpreadsheetApp.openById(CRM_SHEET_ID);
  var hoja = ss.getSheetByName(CRM_TAB_SEG);
  if (!hoja) {
    hoja = ss.insertSheet(CRM_TAB_SEG);
    hoja.appendRow(CRM_COLS);
  }
  var vals = hoja.getDataRange().getValues();
  var fila = {}; // id -> rowIndex (1-based)
  for (var i = 1; i < vals.length; i++) fila[String(vals[i][0])] = i + 1;

  var ids = Object.keys(payload || {});
  for (var k = 0; k < ids.length; k++) {
    var id = ids[k];
    var s = payload[id];
    var row = CRM_COLS.map(function(col){
      if (col === 'id') return id;
      if (col === 'fechaUpdate') return Utilities.formatDate(new Date(),'America/Bogota','yyyy-MM-dd HH:mm');
      if (col === 'historial') return JSON.stringify(s.historial || []);
      return (s[col] !== undefined && s[col] !== null) ? s[col] : '';
    });
    if (fila[id]) hoja.getRange(fila[id], 1, 1, CRM_COLS.length).setValues([row]);
    else hoja.appendRow(row);
  }

  return ContentService
    .createTextOutput(JSON.stringify({ ok:true, guardados: ids.length }))
    .setMimeType(ContentService.MimeType.JSON);
}
