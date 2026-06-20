/********************************************************************
 * MOSS CRM Backend v3 — independiente de ObraControl
 * Soporta JSONP (callback) + proxy hacia Odoo (evita bloqueo CORS)
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
  } else if (action === 'odoo') {
    result = odooProxy(e.parameter.odooUrl, e.parameter.odooKey, e.parameter.odooDb);
  } else {
    result = crmGet();
  }

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

/********************************************************************
 * PROXY HACIA ODOO — usa la API JSON-RPC nativa de Odoo
 * El navegador no puede llamar a Odoo directo por CORS;
 * Apps Script sí puede (server-to-server, sin restricción CORS).
 ********************************************************************/
function odooProxy(odooUrl, odooKey, odooDb) {
  try {
    if (!odooUrl || !odooKey || !odooDb) {
      return respJson({ok:false, error:'Falta odooUrl, odooKey o odooDb'});
    }
    odooUrl = odooUrl.replace(/\/$/, ''); // quitar barra final

    // PASO 1 — Autenticar para obtener el uid real (la API Key funciona como password)
    var authPayload = {
      jsonrpc: '2.0', method: 'call',
      params: {
        service: 'common', method: 'authenticate',
        args: [odooDb, odooKey, odooKey, {}]
        // Nota: en muchas instancias el "login" para API Key puede requerir el
        // correo del usuario en vez de la propia key. Si esto falla con
        // 'Acceso denegado', cambiar el primer odooKey por el correo del usuario,
        // ej: 'juanmanuel@mosscolombia.com.co'
      }
    };
    var authOpt = {method:'post',contentType:'application/json',payload:JSON.stringify(authPayload),muteHttpExceptions:true};
    var authResp = UrlFetchApp.fetch(odooUrl + '/jsonrpc', authOpt);
    var authData = JSON.parse(authResp.getContentText());

    if (authData.error || !authData.result) {
      return respJson({ok:false, error:'Auth falló: '+(authData.error?JSON.stringify(authData.error):'uid no obtenido')});
    }
    var uid = authData.result;

    // PASO 2 — Consultar oportunidades con el uid obtenido
    var payload = {
      jsonrpc: '2.0',
      method: 'call',
      params: {
        service: 'object',
        method: 'execute_kw',
        args: [
          odooDb, uid, odooKey,
          'crm.lead', 'search_read',
          [[['type', '=', 'opportunity']]],
          {
            fields: ['name','partner_name','planned_revenue','stage_id',
                     'user_id','probability','phone','email_from','expected_revenue'],
            limit: 300,
            order: 'planned_revenue desc'
          }
        ]
      }
    };

    var options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    var resp = UrlFetchApp.fetch(odooUrl + '/jsonrpc', options);
    var data = JSON.parse(resp.getContentText());

    if (data.error) {
      return respJson({ok:false, error: data.error.data ? data.error.data.message : JSON.stringify(data.error)});
    }

    var records = data.result || [];
    var oportunidades = records.map(function(r) {
      return {
        id: r.id,
        name: r.name,
        partner_name: r.partner_name,
        planned_revenue: r.planned_revenue,
        stage_name: r.stage_id ? r.stage_id[1] : '',
        user_name: r.user_id ? r.user_id[1] : '',
        phone: r.phone,
        email: r.email_from,
        probability: r.probability
      };
    });

    return respJson({ok:true, oportunidades: oportunidades});

  } catch (err) {
    return respJson({ok:false, error: String(err)});
  }
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
