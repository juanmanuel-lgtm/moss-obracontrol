/********************************************************************
 * MOSS CRM Backend v2 — independiente de ObraControl
 * Soporta JSONP (callback) para evitar bloqueo CORS desde GitHub Pages
 ********************************************************************/

var CRM_SHEET_ID = '1kQZbimtPYBN9O-RDsAIoAQSsuiXxP8btdrGlHdXC7NU';
var CRM_TAB_SEG  = 'CRM_SEGUIMIENTO';
var CRM_COLS = ['id','stage','resultado','nota','proxContacto','intentos',
  'presupuestoCliente','valorCotizado','valorCerrado','m2','responsable',
  'fase1Agendada','fechaCierre','anticipoOK','clasificacion','fechaUpdate','historial'];

function doGet(e) {
  var action   = e.parameter.action   || 'crm';
  var callback = e.parameter.callback || '';
  var payload  = e.parameter.payload  || '';

  var result;
  if (action === 'crm.guardar' && payload) {
    try { result = crmGuardar(JSON.parse(decodeURIComponent(payload))); }
    catch(err) { result = respJson({ok:false, error: String(err)}); }
  } else {
    result = crmGet();
  }

  // Si viene callback → JSONP
  if (callback) {
    var json = result.getContent();
    return ContentService
      .createTextOutput(callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return result;
}

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    if (data.action === 'crm.guardar') return crmGuardar(data.payload);
  } catch(err) {}
  return respJson({ok:false, error:'invalid request'});
}

function crmGet() {
  var ss = SpreadsheetApp.openById(CRM_SHEET_ID);
  var hojaLeads = ss.getSheets()[0];
  var vals = hojaLeads.getDataRange().getValues();
  var leads = [];
  for (var i = 1; i < vals.length; i++) {
    var r = vals[i];
    var id      = String(r[0] || '').trim();
    var nombre  = String(r[1] || '').trim();
    var contacto= String(r[15]|| '').trim();
    if (!id || !nombre) continue;
    if (!contacto && id.length < 7) continue;
    leads.push({
      id: id, nombre: nombre,
      ciudad:           String(r[2] ||'').trim(),
      proyecto:         String(r[3] ||'').trim(),
      tipo:             String(r[4] ||'').trim(),
      espacios:         String(r[5] ||'').trim(),
      m2:               String(r[6] ||'').trim(),
      acabado:          String(r[7] ||'').trim(),
      cumplePresupuesto:String(r[9] ||'').trim(),
      tiempoInicio:     String(r[10]||'').trim(),
      contacto:         contacto,
      fecha: (r[16] instanceof Date)
        ? Utilities.formatDate(r[16],'America/Bogota','yyyy-MM-dd')
        : String(r[16]||'').trim(),
      campana: String(r[18]||'').trim()
    });
  }
  var seg = {};
  var hojaSeg = ss.getSheetByName(CRM_TAB_SEG);
  if (hojaSeg && hojaSeg.getLastRow() > 1) {
    var sv = hojaSeg.getDataRange().getValues();
    for (var j = 1; j < sv.length; j++) {
      var o = {};
      for (var c = 0; c < CRM_COLS.length; c++) o[CRM_COLS[c]] = sv[j][c];
      try { o.historial = JSON.parse(o.historial); } catch(ex) { o.historial = []; }
      if (o.proxContacto instanceof Date)
        o.proxContacto = Utilities.formatDate(o.proxContacto,'America/Bogota','yyyy-MM-dd');
      seg[String(o.id)] = o;
    }
  }
  return respJson({ok:true, leads:leads, seguimiento:seg});
}

function crmGuardar(payload) {
  var ss   = SpreadsheetApp.openById(CRM_SHEET_ID);
  var hoja = ss.getSheetByName(CRM_TAB_SEG);
  if (!hoja) { hoja = ss.insertSheet(CRM_TAB_SEG); hoja.appendRow(CRM_COLS); }
  var vals = hoja.getDataRange().getValues();
  var fila = {};
  for (var i = 1; i < vals.length; i++) fila[String(vals[i][0])] = i + 1;
  var ids = Object.keys(payload || {});
  for (var k = 0; k < ids.length; k++) {
    var id = ids[k], s = payload[id];
    var row = CRM_COLS.map(function(col){
      if (col === 'id')          return id;
      if (col === 'fechaUpdate') return Utilities.formatDate(new Date(),'America/Bogota','yyyy-MM-dd HH:mm');
      if (col === 'historial')   return JSON.stringify(s.historial || []);
      return (s[col] !== undefined && s[col] !== null) ? s[col] : '';
    });
    if (fila[id]) hoja.getRange(fila[id], 1, 1, CRM_COLS.length).setValues([row]);
    else          hoja.appendRow(row);
  }
  return respJson({ok:true, guardados:ids.length});
}

function respJson(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
