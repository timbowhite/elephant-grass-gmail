/* global config and constants */
var config = {},
    constants = {
      version: '0.5',
      bitcoinReceiveAddressApiUrl: 'https://blockchain.info/api/receive?method=create&address={BITCOIN_ADDRESS}',
      bitcoinMonitorAddressApiUrl: 'http://btc.blockr.io/api/v1/address/info/{BITCOIN_ADDRESSES}?confirmations={CONFIRMATIONS}',
      bitcoinQrCodeApiUrl: 'https://blockchain.info/qr?data={BITCOIN_ADDRESS}?amount={BITCOIN_AMOUNT}',
      bitcoinDecimals: 8,
      bitcoinBitsMultiplier: 1000000,
      myContactsGroupName: 'System Group: My Contacts',
      autoReplyLimitDaysMin: 1,
      isAutorun: false, // flag that this run was initiated by a timed trigger
      autorunTimeLimitMs: 6 * 60 * 1000, // # of milliseconds an autorun has to execute
      checkPayments:{
        frequencyMin: 15, // min # of minutes to check for payments
        excludeAddress: []
      },
      errorRegex: {
        serviceLimit: (/Service invoked too many times for one day/ig),
        invalidEmail: (/Invalid email/i)
      },
      autorunFunction: 'processInboxCheckPayments',
      ss: SpreadsheetApp.getActive(),
      sheets:{
        config: {
          name: 'config',
          headerRows: 2
        },
        lists:{
          name: 'lists',
          headerRows: 1
        },
        bounced: {
          name: 'bounced',
          headerRows: 1,
          keyColIdx: 1,
          keyCache: {}  // cache of the sheet's key column (theadId) --> row position
        },
        paid: {
          name: 'paid',
          headerRows: 1
        },
        expired: {
          name: 'expired',
          headerRows: 1
        },
        log: {
          name: 'log',
          headerRows: 1
        },
        otherdata: {
          name: 'otherdata',
          headerRows: 0
        }
      },
      runLimitSec:{
        scanInbox: 50,
        balanceCheck: 200
      },
      lock: undefined  // global script lock, see getScriptLock()
    },
    log = {
      id: Math.random().toString(36).substr(2),
      started: new Date(),
      ended: null,
      runtTime: null,
      operation: null,
      errors: [],
      emailsProcessed: 0,
      emailsBounced: 0,
      sendersWhitelisted: 0,
      sendersBlacklisted: 0,
      balancesChecked: 0,
      paymentsRecd: 0,
      paymentsTotal: 0,
      paymentsExpired: 0
    },
    otherdata = {};

/* utilities */

// normalizes from email field to email address: Amanda Huginkiss <AmandaHuginkiss65@gmail.com> ----> amandahuginkiss65@gmail.com
function from2email(from){
  if (from.indexOf('<') === -1) return from.trim().toLowerCase();
  var email = from.match(/<(.*?@.*?)>/i);
  if (email[1]) return email[1].trim().toLowerCase();
  return from.trim().toLowerCase();
}

// returns an array of elements that are in both passed arrays
function arrayIntersect(a, b) {
    var t;
    if (b.length > a.length) t = b, b = a, a = t; // indexOf to loop over shorter
    return a.filter(function (e) {
        if (b.indexOf(e) !== -1) return true;
    });
}
// removes array elements from a that are in b
function arrayRemoveIntersect(a, b){
  var i, j, k, dup = arrayIntersect(a, b);
  for(i = 0, j = dup.length; i < j; i++){
    if ((k = a.indexOf(dup[i])) === -1) continue;
    a.splice(k, 1);
  }
}

// returns an array with dups removed
function arrayUnique(a) {
    var seen = {}, out = [], len = a.length, j = 0, i, item;
  
    for(i = 0; i < len; i++) {
         item = a[i];
         if(seen[item] !== 1) {
               seen[item] = 1;
               out[j++] = item;
         }
    }
    return out;
}


/**
 * Sorts a 2 dim array by supplied zero based index
 *
 * @param {array} arr    array to sort
 * @param {int} idx      index
 * @param {string} dir   'desc' or 'asc' (default)
 * @param {string} falseyPos 'first' = sort falsey values first, 'last' = sort falsey values last, default = regular sort
 */
function sort2DimArrayByIndex(arr, idx, dir, falseyPos){
  if (dir !== 'desc') dir = 'asc';
  
  function twodimsort(a, b) {
    if ((a[idx] === b[idx]) || (falseyPos && !a[idx] && !b[idx])) return 0;

    if (falseyPos === 'last'){
      if (!a[idx]) return 1;
      if (!b[idx]) return -1;
    }
    
    if (falseyPos === 'first'){
      if (!a[idx]) return -1;
      if (!b[idx]) return 1;
    }

    return (a[idx] < b[idx]) ? (dir === 'asc' ? -1 : 1) : (dir === 'asc' ? 1 : -1);
  }
  arr.sort(twodimsort);
}

/**
 * Searches spreadsheet 2 dim  array for needle, returns row index if found, -1 if not
 *
 * @param {array} sheetCache   2 dim array of sheet data (full data or single column data)
 * @param {mixed} needle       value to search for
 * @param {int} colidx         0 based column index to search in 2nd dim of sheet data array, default = 0
 * @return {int}               index if found, -1 if not found
 **/
function sheetCacheIndexOf(sheetCache, needle, colidx){
  if (! colidx) colidx = 0;
  
  for (var i = 0, j = sheetCache.length; i < j; i++){
    if (sheetCache[i] === needle || (typeof(sheetCache[i]) === 'object' && sheetCache[i][colidx] === needle)) return i;
  }
  return -1;
}


// formats Date into ISO date string
function ISODateString(d){
  function pad(n){return n<10 ? '0'+n : n};
  return d.getUTCFullYear()+'-'
      + pad(d.getUTCMonth()+1)+'-'
      + pad(d.getUTCDate())+'T'
      + pad(d.getUTCHours())+':'
      + pad(d.getUTCMinutes())+':'
      + pad(d.getUTCSeconds()) + '.' + 
      String( (d.getUTCMilliseconds()/1000).toFixed(3) ).slice( 2, 5 )
      + 'Z';
}

// adds days to a date object, returns new date object
// NOTE: this isn't safe for local DST, hence all dates are UTC
function addDays(date, days) {
    var value = date.valueOf();
    value += 86400000 * days;
    return new Date(value);
}

/**
 * converts provided float value to integer representation at X decimals
 *
 * @param {number} val  number (or number string) to scale
 * @param {int} decimals # of decimals to scale
 * @param {bool} [reverse] when reverse = true, integer representation is scaled down to a float
 **/
function scaleNumber(val, decimals, reverse){
  if (reverse) decimals = decimals * -1;
  val = (val * (Math.pow(10, decimals)));
  return reverse ? parseFloat(val) : parseInt(val);
}

/**
 * Formats error object to string for logging
 *
 * @param {object} e    error object
 * @return {string}
 */
function err2str(e){
  var str = e.toString();
  if (e.stack) str += "\n" + e.stack;
  return str;
}

/**
 * Inserts a row of data into a spreadsheet at the provided row index.
 *
 * @param {object} sheet  sheet object
 * @param {array} rowData 1 dim array of row cell data
 * @param {int} [idx]     1 based row index to insert at, default = 1
 * @param {object} [opt]  object of options (none currently)
 */
function insertSheetRow(sheet, rowData, idx, opt) {
  opt = opt || {};
  
  idx = idx || 1;
  sheet.insertRowBefore(idx).getRange(idx, 1, 1, rowData.length).setValues([rowData]);
  SpreadsheetApp.flush();
}

/**
 * Updates a row of data into a spreadsheet using a provided key and key column,
 * or inserts it if the supplied row's key doesn't exist.
 * Note: updating a row is essentially a delete + insert.  The row's prior data will be lost, so need to pass full row data.
 *
 * @param {object} sheet   sheet object
 * @param {array} rowData  1 dim array of row cell data
 * @param {string} key     unique key value
 * @param {int} colidx     1 based key column index in the spreadsheet
 * @param {object} [opt]  object of options
 * @param {int} [opt.insertIdx] row index to insert if key is not found, default = 2
 */
function upsertSheetRow(sheet, rowData, key, colidx, opt) {
  opt = opt || {};
  if (! ('insertIdx' in opt)) opt.insertIdx = 2;

  keycol = sheet.getRange(1, colidx, sheet.getLastRow()).getValues();
  rowidx = sheetCacheIndexOf(keycol, key);
  
  // no row found? insert
  if (rowidx === -1) insertSheetRow(sheet, rowData, opt.insertIdx);
  else{
    rowidx++; // spreadsheet index is 1 based
    sheet.deleteRow(rowidx);
    insertSheetRow(sheet, rowData, rowidx);
  }
  SpreadsheetApp.flush();
}

/**
 * Deletes a row of data into a spreadsheet using a provided key and key column.
 *
 * @param {object} sheet   sheet object
 * @param {string} key     key value
 * @param {int} keyColIdx  1 based key column index
 * @param {object} [opt]   object of options
 * @param {bool} [opt.flush] flag to call SpreadsheetApp.flush(), default = true
 * @return {bool}          true if deleted, false otherwise
 */
function deleteSheetRow(sheet, key, keyColIdx, opt){
  opt = opt || {};
  if (! ('flush' in opt)) opt.flush = true;
  
  var keycol = sheet.getRange(1, keyColIdx, sheet.getLastRow()).getValues(),
  rowidx = sheetCacheIndexOf(keycol, key);
  
  if (rowidx === -1) return false;

  sheet.deleteRow(rowidx + 1);
  if (opt.flush) SpreadsheetApp.flush();
  return true;
}

/**
 * Updates a single row cell based on the provided unique row key.
 *
 * @param {object} sheet   sheet object
 * @param {string} key     key value
 * @param {int} keyColIdx  1 based key column index
 * @param {int} targetColIdx 1 based cell column to update
 * @param {mixed} value    value to set
 * @param {object} [opt]   object of options
 * @param {bool} [opt.flush] flag to call SpreadsheetApp.flush(), default = true
 * @param {bool} [opt.useCache] flag to use the sheet's keyCache to find the row to update. Set to false
 *                         to delete the cache and read from the sheet. default = true
 * @return {bool}          true if a row with the key was found and the cell was updated, otherwise false
 */
function updateCellByKey(sheet, key, keyColIdx, value, targetColIdx, opt){
  opt = opt || {};
  if (! ('flush' in opt)) opt.flush = true;
  if (! ('useCache' in opt)) opt.useCache = true;
 
  var sheetname = sheet.getName(),
      keycol,
      rowidx,
      range,
      i, j;
  
  // use key col cache?
  if (sheetname in constants.sheets && 
      'keyCache' in constants.sheets[sheetname] &&
     keyColIdx === constants.sheets[sheetname].keyColIdx){
    
    // clear cache
    if (! opt.useCache) constants.sheets[sheetname].keyCache = {};
    else{
      // read from cache
      if (Object.keys(constants.sheets[sheetname].keyCache).length &&
          key in constants.sheets[sheetname].keyCache){
        rowidx = constants.sheets[sheetname].keyCache[key];
      }
    }
  }
  
  // read from sheet
  if (typeof(rowidx) !== 'number'){
    keycol = sheet.getRange(1, keyColIdx, sheet.getLastRow()).getValues();
    rowidx = sheetCacheIndexOf(keycol, key);
    
    // cache key col
    if (opt.useCache &&
        sheetname in constants.sheets && 
       'keyCache' in constants.sheets[sheetname] &&
        keyColIdx === constants.sheets[sheetname].keyColIdx){
        constants.sheets[sheetname].keyCache = {};
        for(i = 0, j = keycol.length; i < j; i++){
          constants.sheets[sheetname].keyCache[keycol[i][0]] = i;
        }
    }
    
    if (rowidx === -1) return false;
  }

  sheet.getRange(rowidx + 1, targetColIdx).setValue(value);
  if (opt.flush) SpreadsheetApp.flush();
  return true;
}

/**
 * given a thread object, returns a string hyper link thing to set in a cell
 *
 * @param {object} thread
 * @param {string} [subject]      override subject
 */
function getThreadSubjectHyperlinkValue(thread, subject){
  subject = subject ? subject : thread.getFirstMessageSubject();
  subject = subject.replace(/"/g, '""');
  return '=hyperlink("' + thread.getPermalink() + '";"' + subject + '")';
}

/**
 * writes lists of email addresses to the lists sheet
 *
 * @param {object} [opt]   object of options
 * @param {bool} [opt.removeDups] flag to remove dupes in more than 1 list, default = true
 * @param {array} [opt.lists] array of list names to only sync, default = [] (all of them)
 * @param {bool} [opt.flush] flag to call SpreadsheetApp.flush(), default = true
 */
function syncListsToSpreadsheet(opt){
  opt = opt || {};
  if (! ('removeDups' in opt)) opt.removeDups = true;
  if (! ('flush' in opt)) opt.flush = true;
  if (! ('lists' in opt)) opt.lists = [];
  
  var k, sheet = constants.ss.getSheetByName(constants.sheets.lists.name);
  
  // ensures no single email address appears in one list multiple times,
  // or in any two lists at the same time
  if (opt.removeDups){
    config.lists.whitelist.emails = arrayUnique(config.lists.whitelist.emails);
    config.lists.greylist.emails = arrayUnique(config.lists.greylist.emails);
    config.lists.blacklist.emails = arrayUnique(config.lists.blacklist.emails);

    arrayRemoveIntersect(config.lists.blacklist.emails, config.lists.greylist.emails);
    arrayRemoveIntersect(config.lists.blacklist.emails, config.lists.whitelist.emails);
    arrayRemoveIntersect(config.lists.greylist.emails, config.lists.whitelist.emails);
  }

  // sync lists back to spreadsheet
  for(k in config.lists){
    if (opt.lists.length && opt.lists.indexOf(k) === -1) continue;

    if (! config.lists[k].emails.length) config.lists[k].emails = [''];
    colval = [];
    
    // arrange emails into 2 dim array
    for (i = 0, j = config.lists[k].emails.length; i < j; i++) colval.push([config.lists[k].emails[i]]);
    config.lists[k].range = sheet.getRange(constants.sheets.lists.headerRows + 1, config.lists[k].idx, sheet.getLastRow());
    config.lists[k].range.clear();
    config.lists[k].range = sheet.getRange(constants.sheets.lists.headerRows + 1, config.lists[k].idx, colval.length);
    config.lists[k].range.setValues(colval);
    delete(config.lists[k].range);
  }
  if (opt.flush) SpreadsheetApp.flush(); 
}

/**
 * Adds a contact's email(s) or email address to the white/blacklist cache
 *
 * @param {mixed} contact     contact object or email address
 * @param {string} list       'whitelist', 'blacklist', etc
 */
function addContactEmailsToListCache(contact, list){ 
  var emails = [], email, sheet, rowix;
  if (typeof(contact) === 'string'){
     emails.push(contact);
  }
  else emails = contact.getEmails();
  
  for(var i = 0, j = emails.length; i < j; i++){
    email = typeof(emails[i]) === 'object' ? emails[i].getAddress() : emails[i];
    if (config.lists[list].emails.indexOf(email) !== -1) continue;
    config.lists[list].emails.push(email);
  }
}

/* app funcs */

/**
 * Displays an HTML-service dialog in Google Sheets that contains client-side
 * JavaScript code for the Google Picker API.
 */
function showPicker() {
  var html = HtmlService.createHtmlOutputFromFile('Picker.html')
      .setWidth(700)
      .setHeight(500)
      .setSandboxMode(HtmlService.SandboxMode.IFRAME);
  SpreadsheetApp.getUi().showModalDialog(html, 'Select an Elephant Grass spreadsheet to import');
}
 
function getOAuthToken() {
  DriveApp.getRootFolder();
  return ScriptApp.getOAuthToken();
}

/**
 * Imports an existing spreadsheet's data into this spreadsheet.
 *
 * @param {string} fileid             the existing spreadsheet's file id
 * @return {mixed}                    true on success, error string on failure
 */
function importSpreadsheet(fileid){
  var oldss = SpreadsheetApp.openById(fileid),
      oldotherdata,
      oldversion,
      oldsheet,
      oldrows,
      newsheet,
      i, j, k, v;
  
  if (! oldss) return false;
 
  oldotherdata = loadOtherdata(oldss, true);
  oldversion = oldotherdata.version;
  loadOtherdata();
  
  // can't import into the same spreadsheet
  if (fileid === constants.ss.getId()){
    return "Can't import the same spreadsheet into itself.  Please select a different spreadsheet.";
  }
  
  // implement upgrade logic based on version here: oldversion vs. otherdata.version
  
  // config
  try{
    oldsheet = oldss.getSheetByName(constants.sheets.config.name);
    oldrows = oldsheet.getDataRange().getValues();
    newsheet = constants.ss.getSheetByName(constants.sheets.config.name);
    for (i = 0, j = oldrows.length; i < j; i++){
      // skip headers
      if (i < constants.sheets.config.headerRows) continue;
      k = oldrows[i][3].toString().trim().toLowerCase();
      if (! k) continue;
      v = oldrows[i][2].toString().trim();
      updateCellByKey(newsheet, k, 4, v, 3, {flush: false, useCache: false});    
    }
    
    // disable autorun on the old spreadsheet
    
    // otherdata
    for(k in oldotherdata){
      if (k === 'version') continue;
      otherdata[k] = oldotherdata[k];
    }
    saveOtherdata();
    
    // everything else
    for(k in constants.sheets){
      if (k === 'config' || k === 'otherdata') continue;
      oldsheet = oldss.getSheetByName(constants.sheets[k].name);
      newsheet = constants.ss.getSheetByName(constants.sheets[k].name);
      if (! oldsheet) continue;
      
      v = oldsheet.getRange(constants.sheets[k].headerRows + 1, 1, oldsheet.getLastRow(), oldsheet.getLastColumn()).getValues();
      if (! v[0].length) continue;

      newsheet.getRange(constants.sheets[k].headerRows + 1, 1, v.length, v[0].length).setValues(v);
      
    }
  }
  catch(e){
     return err2str(e);
  }
  

  
  SpreadsheetApp.flush();
  return true;
}

/**
 * checks if the script is nearing the 6 min execution time limit
 *
 * @param {int} window            check if we're within this many milliseconds of limit, default = 30000
 */
// returns true if within 30 seconds of limit
function isTimeUp(window){
  if (typeof(window) === 'undefined') window = 30 * 1000;
  if (! log.started) return false;
  var now = new Date();
  return (now.getTime() - log.started.getTime()) >= (constants.autorunTimeLimitMs - window); // 4 minutes
}

function onOpen(e) {
 var ui = SpreadsheetApp.getUi();
  ui.createMenu('Run')
  .addItem('Process Inbox + Check For Payments', 'processInboxCheckPayments')
  .addItem('Process Inbox', 'processInbox')
  .addItem('Check For Payments', 'checkPayments')
  .addSeparator()
  .addItem('Stop Running Automatically', 'stopAutorun')
  .addItem('Import Spreadsheet Data', 'showPicker')
  .addSeparator()
  .addItem('Clear Log', 'clearLog')
  .addToUi();
}

// Initializes environment, calls
// - initConfig
// - loadOtherdata
// - clearLog (to maintain a sane log size)
function init(){
  initConfig();
  loadOtherdata();
  if(config.log) clearLog({getLock: false, initConfig: false, keepRows: config.log_max_rows - 1});
}

/**
 * Sets config options key/val object read from the attached spreadsheet's config sheet into the global config var
 *
 */
function initConfig() {
  var sheet = constants.ss.getSheetByName(constants.sheets.config.name),
      rows = sheet.getDataRange().getValues(),
      range,
      i, j, k, x,
      autorunTriggerId,
      yesRegex = /y(?:es)?/i;
  
  for (i = 0, j = rows.length; i < j; i++) {
    // skip headers
    if (i < constants.sheets.config.headerRows) continue;
    k = rows[i][3].toString().trim().toLowerCase();
    if (! k) continue;
    
    switch(k){
      // parse bool options
      case 'autoreply_html':
      case 'archive_flagged_threads':
      case 'mark_flagged_threads_read':
      case 'remove_blacklist_contacts_from_my_contacts':
      case 'add_paid_sender_to_whitelist':
      case 'log':
        config[k] = yesRegex.test(rows[i][2].toString().trim());
        break;
      
      // cast ints
      case 'confirmations':
      case 'expire_days':
      case 'check_payments_frequency':
      case 'greylist_sender_payments':
      case 'blacklist_sender_payments':
      case 'log_max_rows':
      case 'autorun':
        config[k] = parseInt(rows[i][2].toString().trim());
        break;
      
      // cast floats
      case 'bitcoin_amount':
        config[k] = parseFloat(rows[i][2].toString().trim());
        break;
      
      // others
      case 'bitcoin_amount_min':
        x = rows[i][2].toString().trim();
        config[k] = x ? parseFloat(x) : config.bitcoin_amount;
        break;
      
      case 'autoreply_limit_days':
        config[k] = parseInt(rows[i][2].toString().trim());
        if (config[k] < constants.autoReplyLimitDaysMin) config[k] = constants.autoReplyLimitDaysMin;
        break;
        
      default:
        config[k] = rows[i][2].toString().trim();
        break;
    }
  }
  
  // (re)hide the config key column (4)
  range = sheet.getRange("D1");
  sheet.hideColumn(range);
  
  // setup/disable triggers if necessary
  initAutorun({triggerId: autorunTriggerId});
}

/**
 * loads the otherdata JSON object into global otherdata variable
 *
 * @param {object} [ss]             spreadsheet object, constants.ss used if not supplied.
 * @param {bool} [returnData]       flag to return otherdata object instead of setting it in the global otherdata var, default = false
 */
function loadOtherdata(ss, returnData){
  ss = ss || constants.ss;
  
  var sheet = ss.getSheetByName(constants.sheets.otherdata.name);
  if (! sheet) return {};
  
  var range = sheet.getRange(constants.sheets.otherdata.headerRows + 1, 1, 1);
  if (! range) return {};
  
  var val = range.getValues()[0][0].toString().trim();

  try{
    val = JSON.parse(val);
  }
  catch(e){
    val = ''; 
  }
  val = val || {};
  if (returnData) return val;
  
  otherdata = val;
  otherdata.version = constants.version;
}

// saves global otherdata variable into the otherdata sheet
function saveOtherdata(){
  var sheet = constants.ss.getSheetByName(constants.sheets.otherdata.name);
  sheet.getRange(constants.sheets.otherdata.headerRows + 1, 1, 1).setValue(JSON.stringify(otherdata));
}

/**
 * initializes or destroys time based triggers
 *
 * @return {bool}     returns false if the autorun trigger was disabled, otherwise true
 */
function initAutorun(){
  var trigger, 
      i, j,
      allTriggers =  ScriptApp.getProjectTriggers();
  
  // see if trigger is already installed, use function name as unique id
  for (i = 0, j = allTriggers.length; i < j; i++) {
    if (constants.autorunFunction === allTriggers[i].getHandlerFunction()){
      trigger = allTriggers[i];
      constants.isAutorun = true;
      break;
    }
  }
  
  // enable
  if (config.autorun){
    // already installed?
    if (trigger) return true;
    
    ScriptApp.newTrigger(constants.autorunFunction)
      .timeBased()
      .everyMinutes(config.autorun)
      .create();
    return;
  }
  
  // disable
  if (! trigger) return true;
  ScriptApp.deleteTrigger(trigger);
  return false;
}

/**
 * Kills the time-base autorun trigger (if it exists)
 *
 * @return {bool}            true if the trigger was deleted, false otherwise
 */
function stopAutorun(){
  var i, j,
      allTriggers =  ScriptApp.getProjectTriggers();
  
  // see if trigger is installed, use function name as unique id
  for (i = 0, j = allTriggers.length; i < j; i++) {
    if (constants.autorunFunction === allTriggers[i].getHandlerFunction()){
      ScriptApp.deleteTrigger(allTriggers[i]);
      return true;
    }
  }
  
  return false;
}

/**
 * Returns an array of strings of the user's email addresses including aliases
 *
 * @return array
 */
function getMyEmailAddresses(){
  var myaddy = GmailApp.getAliases() || [],
      x;
  if ((x = Session.getEffectiveUser().getEmail()) && myaddy.indexOf(x) === -1){
    myaddy.push(x);
  }
  return myaddy;
}

/**
 * - Reads in the white/grey/blacklists from spreadsheet to config object
 * - syncs contacts from "My Contacts" to whitelist
 * - ensures no single email address appears in any two lists at the same time
 *  - if so, removes email address from "darker" list(s)
 *
 * @param {object} [opt]                object of options
 * @param {bool} [opt.readonly]         flag to only read in lists from spreadsheets, dont' make any modifications, default = false
 * @return {void}
 */
function initLists(opt){
  var i, j, k, u, v, x, y, 
      sheet = constants.ss.getSheetByName(constants.sheets.lists.name),
      sheetdata,
      myaddy,
      contacts,
      range;
  
  opt = opt || {};
  if (! ('readonly' in opt)) opt.readonly = false;
  
  config.lists = {
    whitelist: {
      idx: 1,
      emails: []
    },
    greylist: {
      idx: 2,
      emails: []
    },
    blacklist: {
      idx: 3,
      emails: []
    }
  };
  // key/val map of senders -> expired payments count
  config.expired = {};

  // read in lists from spreadsheet, filter out empty cells
  for(k in config.lists){
    sheetdata = sheet.getRange(constants.sheets.lists.headerRows + 1, config.lists[k].idx, sheet.getLastRow()).getValues();
    config.lists[k].emails = sheetdata.filter(function(c){ return c[0]; }).map(function(c){ return c[0].toString().trim(); });
  }

  // add email addresses from "My Contacts" to whitelist
  contacts = ContactsApp.getContactGroup(constants.myContactsGroupName).getContacts();
  for(i = 0, j = contacts.length; i < j; i++) addContactEmailsToListCache(contacts[i], 'whitelist');
  
  // ensure this account + aliases are in email whitelist cache
  myaddy = getMyEmailAddresses();
  for(i = 0, j = myaddy.length; i < j ; i++) addContactEmailsToListCache(myaddy[i], 'whitelist');

  syncListsToSpreadsheet({flush: true});
  
  // load expired data into config
  sheet = constants.ss.getSheetByName(constants.sheets.expired.name);
  sheetdata = sheet.getRange(constants.sheets.expired.headerRows + 1, 1, sheet.getLastRow(), 2).getValues();
  for (i = 0, j = sheetdata.length; i < j; i++){
    if (! sheetdata[i][0]) continue;
     
    // delete blacklisted from expired
    if (config.lists.blacklist.emails.indexOf(sheetdata[i][0]) !== -1){
      deleteSheetRow(sheet, sheetdata[i][0], 1);
    }
    else{
      config.expired[sheetdata[i][0]] = parseInt(sheetdata[i][1].toString().trim());
    }
  }
}

// scans the inbox/spam for emails to bounce, then:
// - gets a unqiue receiving Bitcoin address
// - autoreplies to the email requesting payment
// - marks email as read, labels thread, and archives it depending on config
//
function _processInbox(){
  var inc = 100, 
      offset = 0, 
      start = new Date(),
      now = new Date(),
      expires = addDays(now, parseInt(config.expire_days)),
      row,
      recd,
      autoreplyLimitMs = config.autoreply_limit_days * 86400000,
      i, j, k, x, y,
      threads,
      thread,
      threadId,
      threadIds = {},
      messages,
      message,
      from,
      sheet = constants.ss.getSheetByName(constants.sheets.bounced.name),
      sheetRowStart = constants.sheets.paid.headerRows + 1,
      sheetdata = {
        threadId: sheet.getRange(sheetRowStart, 1, sheet.getLastRow()).getValues(),
        from: sheet.getRange(sheetRowStart, 3, sheet.getLastRow()).getValues(),
        received: sheet.getRange(sheetRowStart, 7, sheet.getLastRow()).getValues()
      },
      sheetPaidData = {
        threadId: constants.ss.getSheetByName(constants.sheets.paid.name).getRange(constants.sheets.paid.headerRows + 1, 1, sheet.getLastRow()).getValues()
      },
      labels = {
        paymentPending: GmailApp.getUserLabelByName(config.payment_pending_label) || GmailApp.createLabel(config.payment_pending_label),
      },
      apiresult,
      err,
      btcaddress,
      btcaddressUrl = constants.bitcoinReceiveAddressApiUrl.replace('{BITCOIN_ADDRESS}', config.bitcoin_address),
      amount,
      todo = {},
      body,
      replyOpt,
      threadLabels,
      threadLabelsNames = [],
      ignore,
      aborted = false,
      cannotreply = false,
      sent,
      myaddy = getMyEmailAddresses();
  
  // thread processing loop
  do  {
    now = new Date();
    threads = GmailApp.search(config.process_emails_search, offset, inc);
    
    offset += inc;
    messages = GmailApp.getMessagesForThreads(threads);

    for (i = 0, j = messages.length ; i < j; i++) {
      if (isTimeUp()){
        log.errors.push(arguments.callee.name + ': aborting processing, execution time limit is nigh');
        aborted = true;
        break; 
      }
      
      // get initial incoming message
      message = messages[i][0];
      from = from2email(message.getFrom());
      if (! from) continue;

      // ignore whitelisted contacts
      if (config.lists.whitelist.emails.indexOf(from) !== -1) continue;
      
      thread = message.getThread();
      threadId = thread.getId();
      
      // bogus thread id or already paid thread
      if (! threadId || (sheetCacheIndexOf(sheetPaidData.threadId, threadId) !== -1)) continue;
      
      // ignore threads w/ payment complete label
      threadLabels = thread.getLabels();
      threadLabelsNames = [];
      for (x = 0, y = threadLabels.length; x < y; x++) threadLabelsNames.push(threadLabels[x].getName());
      if (threadLabelsNames.indexOf(config.payment_received_label) !== -1) continue;
      
      // ignore if original message has been replied to manually by user and does not have pending payment label
      if (threadLabelsNames.indexOf(config.payment_pending_label) === -1){
        ignore = false;
        for (x = 1, y = messages[i].length; x < y; x++){
          if (myaddy.indexOf(from2email(messages[i][x].getFrom())) !== -1){
              ignore = true;
              break;
          }
        }
        if (ignore) continue;
      }

      todo = {
        addrow: true,
        bounce: true,
        label: true,
        archive: true
      };
      
      // blacklisted? just archive it
      if (config.lists.blacklist.emails.indexOf(from) !== -1){
        todo.addrow = false;
        todo.bounce = false;
        todo.label = false;
      }
      
      // duplicate thread id means we got a reply to our autoreply. don't bounce or track it
      if ((todo.addrow || todo.bounce) && sheetCacheIndexOf(sheetdata.threadId, threadId) !== -1){
        todo.addrow = false;
        todo.bounce = false;
      }
      
      // don't autoreply if this sender's last email was within X days
      // (assumes sheetdata is still sorted by the newest first)
      recd = null;
      if (todo.bounce && ((recd = sheetCacheIndexOf(sheetdata.from, from)) !== -1)){
        recd = sheetdata.received[recd] ? sheetdata.received[recd][0] : '';
        if (recd &&
           (recd = new Date(recd)) &&
           (recd.getTime() + autoreplyLimitMs > now.getTime())){
          todo.bounce = false;
        }
      }
      
      amount = '';
      btcaddress = '';
      bouncedate = '';
      
      // autoreply
      if (todo.bounce){
        // reached daily email limit? then leave this email untouched for next run
        if (cannotreply) break;
        
        amount = config.bitcoin_amount;
        
        // get bitcoin receive address        
        err = '';
        try{
          apiresult = UrlFetchApp.fetch(btcaddressUrl).getContentText(); // ~.3s
          btcaddress = JSON.parse(apiresult).input_address;
        }
        catch(e){
          err = e.toString();
        }
          
        if (! btcaddress || err){
          log.errors.push([arguments.callee.name + ': failed to get Bitcoin address from API', JSON.stringify(apiresult, null, 2), err2str(err), url].join("\n"));
          continue;
        }
        
        // if the checkPayments function is going to be executed later this run,
        // don't check for this address yet
        constants.checkPayments.excludeAddress.push(btcaddress);
        
        body = config.autoreply_template
        .replace('{BITCOIN_AMOUNT_BITS}', (config.bitcoin_amount * constants.bitcoinBitsMultiplier).toFixed(0))
        .replace('{EXPIRE_DAYS}', config.expire_days)
        .replace('{BITCOIN_QR_CODE_URL}', constants.bitcoinQrCodeApiUrl)
        .replace(/\r?\n/g, "\r\n");
        
        // replace address/amount in body + url in one shot
        body = body.replace(/{BITCOIN_ADDRESS}/g, btcaddress)
        .replace(/{BITCOIN_AMOUNT}/g, config.bitcoin_amount);
        
        bouncedate = ISODateString(now);

        // use html?
        replyOpt = {};
        if (config.autoreply_html) replyOpt.htmlBody = body.split("\n").join("<br/>");
        sent = true;
        
        try{
          message.reply(body, replyOpt);
        }
        catch(e){
          log.errors.push(arguments.callee.name + 
           ' failed to send autoreply for threadId = ' + threadId + 
           ', subject = ' + thread.getFirstMessageSubject() + ' : ' + err2str(e));
          
          sent = false;
          
          // outgoing email limit reached? skip it.
          if (constants.errorRegex.serviceLimit.test(e.toString())){
            cannotreply = true;
            continue;
          }
          
          // if its not an invalid reply-to address, skip it.
          // invalid reply-to address still get archived+labeled
          if (! constants.errorRegex.invalidEmail.test(e.toString())) continue;
        }
        cannotreply = false;
        if (sent) log.emailsBounced++;
      }
      
      // queue to archive
      if (todo.archive) threadIds[threadId] = thread;
      
      // mark read, label
      if (todo.label){
        if (config.mark_flagged_threads_read) message.markRead(); // ~1s per message
        thread.addLabel(labels.paymentPending); // ~ .5s per thread
      }
      
      // stash data
      if (todo.addrow){
        recd = ISODateString(thread.getLastMessageDate());
        sheet.appendRow([
          threadId,
          getThreadSubjectHyperlinkValue(thread),
          from,
          btcaddress,
          amount,
          config.payment_pending_label,
          recd,
          bouncedate,
          ISODateString(expires)
        ]);
        
        // update cached spreadsheet data
        sheetdata.threadId.push([threadId]);
        sheetdata.from.push([from]);
        sheetdata.received.push([recd]);
      }
      log.emailsProcessed++;
    }
  } while (threads.length === inc && aborted === false);
  
  // move all threads to archive in groups for speed
  if (config.archive_flagged_threads){
    x = 100; // google limit
    while(Object.keys(threadIds).length){
      threads = [];
      for (k in threadIds){
        threads.push(threadIds[k]);
        delete(threadIds[k]);
        if (threads.length >= x) break;
      }
      GmailApp.moveThreadsToArchive(threads);
    }
  }

  // sort the sheet by received desc, easier for users to read
  sheet.sort(7, false);
}

/**
 * Adds/updates a run log entry to the log sheet
 *
 * @param {object} [opt]
 * @param {string} [opt.operation] run description, default = log.operation
 * @param {bool} [opt.end] flag that the run is done and to calc runTime and update the run start log entry, default = false
 **/
function writeLog(opt){
  if (! config.log) return;
  
  opt = opt || {};
  if (! ('end' in opt)) opt.end = false;
  if (! ('operation' in opt)) opt.operation = log.operation;
  
  var sheet = constants.ss.getSheetByName(constants.sheets.log.name);
  
  if (opt.operation && ! opt.end && ! log.operation) log.operation = opt.operation;
  
  if (opt.end && log.started){
    log.ended = new Date();
    log.runTime = (log.ended.getTime() - log.started.getTime()) / 1000;
  }
  
  var row = [
    log.id,
    log.started ? ISODateString(log.started) : null,
    log.ended ? ISODateString(log.ended) : null,
    log.runTime ? log.runTime : null,
    opt.operation,
    log.errors.join("\n"),
    log.emailsProcessed,
    log.emailsBounced,
    log.sendersWhitelisted,
    log.sendersBlacklisted,
    log.balancesChecked,
    log.paymentsRecd,
    log.paymentsTotal,
    log.paymentsExpired
  ];
  
  if (! opt.end) return insertSheetRow(sheet, row, constants.sheets.log.headerRows + 1);
  upsertSheetRow(sheet, row, log.id, 1);
}

// checks bounced email for payments
function _checkPayments(){
  var i, j, k, x, u, v,
      sheetbounced = constants.ss.getSheetByName(constants.sheets.bounced.name),
      sheetpaid,
      sheetexpired,
      sheetdata = {}, 
      sheetpaiddata,
      checkaddy = {},
      addy,
      url,
      err,
      from,
      apiresult,
      expire,
      threads = [],
      thread,
      threadId,
      recd,
      lastChecked,
      paidThreads = {},
      expiredThreads = {},
      now = new Date(),
      nowiso = ISODateString(now),
      checkamount = scaleNumber(config.bitcoin_amount_min, constants.bitcoinDecimals),
      paidLabel,
      unpaidLabel,
      contact,
      message,
      checkfreq,
      batchCount = 20, // blockr.io API address lookup limit
      batch = [],
      colval,
      range,
      aborted = false,
      execLimitWindow = 120000; // milliseconds prior to execution limit to abort
  
  // enforce minimum check payments frequency
  checkfreq = (config.check_payments_frequency < constants.checkPayments.frequencyMin ? 
    config.check_payments_frequency : constants.checkPayments.frequencyMin) * 60 * 1000;
  
  // time to check payments?
  if (otherdata.checkPaymentsLast &&
      (lastChecked = new Date(otherdata.checkPaymentsLast.trim())) &&
     ((lastChecked.getTime() + checkfreq) > now.getTime())){
       return;
  }
  
  // loop over bounced spreadsheet in batches
  sheetdata = sheetbounced.getRange(constants.sheets.bounced.headerRows + 1, 1, sheetbounced.getLastRow(), sheetbounced.getLastColumn()).getValues();
  
  // remove rows that don't have addresses, are not due to be checked, or have expired
  sheetdata = sheetdata.filter(function(row, i){
    var d, threadId, addy;
    
    // has threadId and address?
    if(! (threadId = row[0].toString().trim())) return false;
    if (! (addy = row[3].toString().trim())) return false;
    
    // should this address be excluded (b/c it was just generated)
    if (constants.checkPayments.excludeAddress.indexOf(addy) !== -1) return false;
    
    // expired?
    d = row[8].toString().trim();
    threadId = row[0].toString().trim();
    if ((d = new Date(d)) &&
       (d.getTime() <= now.getTime())){
        expiredThreads[threadId] = {
          from: row[2].toString().trim()
        };
        log.paymentsExpired++;
      return false;
    }

    // not due to be checked?
    d = row[9].toString().trim();
    if (d && 
       (d = new Date(d)) &&
      ((d.getTime() + checkfreq) > now.getTime())){
      return false;
    }
    return true;
  });
  
  // sort so that unchecked address + oldest checked addresses are always first
  sort2DimArrayByIndex(sheetdata, 9, 'asc', 'first');
  
  for(u = 0, v = sheetdata.length; u < v; u += batchCount){
    // abort if we're at the 2 minute warning
    if (isTimeUp(execLimitWindow)){
      log.errors.push(arguments.callee.name + ' aborting processing, execution time limit is nigh');
      aborted = true;
      break; 
    }
    
    batch = sheetdata.slice(u, u + batchCount);
    checkaddy = {};
    err = '';
    
    // gather addresses to be checked
    for(i = 0, j = batch.length; i < j; i++){
      threadId = batch[i][0].toString().trim();
      addy = batch[i][3].toString().trim();

      checkaddy[addy] = {
        threadId: threadId,
        from: batch[i][2].toString().trim(),
        sheetCacheIndex: u + i
      };
    }
    
    // build api url
    if (! Object.keys(checkaddy).length) continue;
    url = constants.bitcoinMonitorAddressApiUrl
      .replace('{BITCOIN_ADDRESSES}', Object.keys(checkaddy).join(','))
      .replace('{CONFIRMATIONS}', config.confirmations);

    try{
      apiresult = UrlFetchApp.fetch(url).getContentText();
      apiresult = JSON.parse(apiresult);
    }
    catch(e){
      err = e.toString();
    }
    
    // valid result?
    if (typeof(apiresult) !== 'object' ||
        apiresult.status !== 'success' ||
        typeof(apiresult.data) !== 'object'){
      log.errors.push([arguments.callee.name + ': got an invalid bitcoin address monitor apiresult', JSON.stringify(apiresult, null, 2), err2str(err), url].join("\n"));
      continue;
    }
    
    if (! (apiresult.data instanceof Array)) apiresult.data = [apiresult.data];
    j = apiresult.data.length;
    x = Object.keys(checkaddy).length;
    if (j !== x){
      log.errors.push(arguments.callee.name + ': Bitcoin monitor address API result count (' + j + ') does not match expected count (' + x + '), truncating...');
      apiresult.data = apiresult.data.slice(0, x);
      j = x;
    }
    
    // process results
    for(i = 0; i < j; i++){
      // abort if we're at the 2 minute warning
      if (isTimeUp(execLimitWindow)){
        log.errors.push(arguments.callee.name + ': aborting processing, execution time limit is nigh');
        aborted = true;
        break;
      }
      
      if (! (apiresult.data[i].address in checkaddy)) continue;
      addy = apiresult.data[i].address;
      
      // update balance last checked timestamp
      sheetdata[checkaddy[addy].sheetCacheIndex][9] = nowiso;
      updateCellByKey(sheetbounced, checkaddy[addy].threadId, 1, nowiso, 10, {flush: false});
      
      // paid? blockr.io will report a balance, but not totalreceived for unconfirmed transactions
      // most interested in totalreceived since this txn will be forwarded
      recd = scaleNumber(apiresult.data[i].totalreceived, constants.bitcoinDecimals);
      if (! recd && ! config.confirmations) recd = scaleNumber(apiresult.data[i].balance, constants.bitcoinDecimals);
      
      // chec confirmations
      if (config.confirmations){

        // assume first txn was a full payment, make sure it has enough confirmations
        if (! apiresult.data[i].first_tx || (parseInt(apiresult.data[i].first_tx.confirmations) < config.confirmations)){
          recd = 0;
        }
      }
      log.balancesChecked++;
      
      // limit testing
      //Utilities.sleep(30000);
      
      if (recd < checkamount) continue;
      
      // ka-ching!
      log.paymentsRecd++;
      log.paymentsTotal += recd;
      
      // stash paid threads to be processed in bulk later
      paidThreads[checkaddy[addy].threadId] = {
        thread: GmailApp.getThreadById(checkaddy[addy].threadId),
        from: checkaddy[addy].from,
        row: sheetdata[checkaddy[addy].sheetCacheIndex]
      };
      
      // add sender to white/grey list?
      if(config.add_sender_to_list && config.add_sender_to_list in config.lists){
        addContactEmailsToListCache(checkaddy[addy].from, config.add_sender_to_list);
        syncListsToSpreadsheet({removeDups: true, flush: true});
      }
    }
  }
  SpreadsheetApp.flush();
  
  if (sheetdata.length && ! aborted){
    otherdata.checkPaymentsLast = ISODateString(new Date());
    saveOtherdata();
  }
  
  log.paymentsTotal = scaleNumber(log.paymentsTotal, constants.bitcoinDecimals, true);
  
  // process paid threads
  if (Object.keys(paidThreads).length){
    unpaidLabel = GmailApp.getUserLabelByName(config.payment_pending_label) || GmailApp.createLabel(config.payment_pending_label);
    paidLabel = GmailApp.getUserLabelByName(config.payment_received_label) || GmailApp.createLabel(config.payment_received_label);
    threads = [];
    sheetpaid = constants.ss.getSheetByName(constants.sheets.paid.name);
    sheetpaiddata = sheetpaid.getRange(constants.sheets.paid.headerRows + 1, 1, sheetpaid.getLastRow(), sheetpaid.getLastColumn()).getValues();
      
    // reload full sheet data
    sheetdata = sheetbounced.getRange(constants.sheets.bounced.headerRows + 1, 1, sheetbounced.getLastRow(), sheetbounced.getLastColumn()).getValues();
    
    handlePaidThread = function(thread, threadId, row, from, moveToPaid, checkPromoteSender){
      var i, j, paidCount = 0;
      
      thread.removeLabel(unpaidLabel);
      thread.addLabel(paidLabel);
      if (config.mark_flagged_threads_read) thread.markUnread();
      
      // copy the bounced row into the paid sheet
      if (moveToPaid && row.length){
        // need to reformat hyperlink
        row[1] = getThreadSubjectHyperlinkValue(thread, row[1]);
        // change the status
        row[5] = config.payment_received_label;
        upsertSheetRow(sheetpaid, row, threadId, 1);
        sheetpaiddata.push(row);
      }
      
      deleteSheetRow(sheetbounced, threadId, 1, {flush: false});
      
      // promote sender from greylist -> whitelist?
      if (checkPromoteSender &&
          config.add_sender_to_list !== 'whitelist' && 
          config.whitelist_greylist_sender_payments &&
          config.lists.greylist.emails.indexOf(from) !== -1){
        
        // get count of their paid threads
        for (i = 0, j = sheetpaiddata.length; i < j ; i++){
          // must match sender and have an address
          if (from !== sheetpaiddata[i][2].toString().trim() || ! sheetpaiddata[i][3].toString().trim()) continue;
          paidCount++;
        }
             
        if (paidCount >= config.whitelist_greylist_sender_payments){
          addContactEmailsToListCache(from, 'whitelist');
          syncListsToSpreadsheet({lists: ['whitelist', 'greylist'], removeDups: true, flush: false});
          log.sendersWhitelisted++;
        }
      }
    }
    
    for(k in paidThreads){
      handlePaidThread(paidThreads[k].thread, k, paidThreads[k].row, paidThreads[k].from, true, true);
      threads.push(paidThreads[k].thread);
        
      // find any other threads matching sender's from address
      for(i = 0, j = sheetdata.length; i < j; i++){
        if (sheetdata[i][2].toString().trim() !== paidThreads[k].from) continue;
        
        // ignore if we already have it
        threadId = sheetdata[i][0].toString().trim();
        if (k === threadId) continue;
        thread = GmailApp.getThreadById(threadId);

        if (! thread) continue;
        handlePaidThread(thread, threadId, sheetdata[i], paidThreads[k].from, false, false);
        threads.push(thread);
      }
    }
    SpreadsheetApp.flush();
    GmailApp.moveThreadsToInbox(threads);
  }
  
  // process expired threads
  if (Object.keys(expiredThreads).length){
    x = false;

    for(threadId in expiredThreads){
      from = expiredThreads[threadId].from;
      config.expired[from] = (expiredThreads[threadId].from in config.expired) ? config.expired[from] + 1 : 1;
   
      deleteSheetRow(sheetbounced, threadId, 1, {flush: false});

      // blacklist sender?
      if (config.blacklist_sender_payments &&
          config.expired[from] >= config.blacklist_sender_payments &&
          config.lists.greylist.emails.indexOf(from) === -1 &&
          config.lists.blacklist.emails.indexOf(from) === -1){
        addContactEmailsToListCache(from, 'blacklist');
        log.sendersBlacklisted++;
        x = true;
      }
    }
    
    if (x) syncListsToSpreadsheet({lists: 'blacklist', removeDup: false, flush: false});
    
    // sync expired counts back to sheet
    sheetexpired = constants.ss.getSheetByName(constants.sheets.expired.name);
    colval = [];
    for(from in config.expired) colval.push([from, config.expired[from]]);
    range = sheetexpired.getRange(constants.sheets.expired.headerRows + 1, 1, sheetexpired.getLastRow(), 2);
    range.clear();
    range = sheetexpired.getRange(constants.sheets.expired.headerRows + 1, 1, colval.length, 2);
    range.setValues(colval);
    SpreadsheetApp.flush();
  }
}

/**
 * deletes rows from the spreadsheet log
 *
 * @param {object} [opt]           object of options
 * @param {int} [opt.keepRows]     # of rows to retain, delete all others afterwards
 * @param {bool} [opt.getLock]     get a global script lock, default = true
 * @param {bool} [opt.initConfig]  flag to call initConfig, default = true
 */
function clearLog(opt){
  opt = opt || {};
  if (! ('keepRows' in opt)) opt.keepRows = 0;
  if (! ('getLock' in opt)) opt.getLock = true;
  if (! ('initConfig' in opt)) opt.initConfig = true;
  
  if (opt.getLock) getScriptLock();
  try{
    if (opt.initConfig) initConfig();
    var sheet = constants.ss.getSheetByName(constants.sheets.log.name),
        rows = sheet.getDataRange(),
        i = constants.sheets.log.headerRows + 1 + opt.keepRows,
        j = rows.getNumRows() - i + 1;

     if (j < 1) return;
     sheet.deleteRows(i, j);
  }
  finally{
    if (opt.getLock) constants.lock.releaseLock();
  }
}

// removes all data from the sheets (except the config)
function clearAllSheetData(){
  var sheets = ['lists', 'bounced', 'paid', 'expired', 'log', 'otherdata'],
      sheet,
      rows,
      x, y,
      i, j;
  getScriptLock();
  try{
    for(x = 0, y = sheets.length; x < y; x++){
      sheet = constants.ss.getSheetByName(constants.sheets[sheets[x]].name);
      rows = sheet.getDataRange();
      i = constants.sheets[sheets[x]].headerRows + 1;
      j = rows.getNumRows() - constants.sheets[sheets[x]].headerRows;

      if (j < 1) continue;
      sheet.deleteRows(i, j);
    }
  }
  finally{
    constants.lock.releaseLock();
  }
}

// gets a global script lock to prevent concurrent runs,
// throws exception if lock could not be acquired
function getScriptLock(){
  if (constants.lock) throw new Error('Global script lock already exists');
  constants.lock = LockService.getScriptLock();
  constants.lock.waitLock(10000);
}

// handles incoming email
function processInbox(){
  try{
    getScriptLock();
    init();
    writeLog({operation: 'processInbox'});
    initLists();
    _processInbox();
    writeLog({end: true});
  }
  catch(e){
    log.errors.push(arguments.callee.name + ' failed: ' + err2str(e));
    writeLog({end: true});
  }
  finally{
    if (constants.lock) constants.lock.releaseLock();
  }
}

// checks bounced email for payments
function checkPayments(){
  try{
    getScriptLock();
    init();
    writeLog({operation: 'checkPayments'});
    initLists({readonly: true});
    _checkPayments();
    writeLog({end: true});
  }
  catch(e){
    log.errors.push(arguments.callee.name + ' failed: ' + err2str(e));
    writeLog({end: true});
  }
  finally{
    if (constants.lock) constants.lock.releaseLock();
  }
}

// handles incoming email + checks bounced email for payments
function processInboxCheckPayments(){
  try{
    getScriptLock();
    init();
    writeLog({operation: 'processInboxCheckPayments'});
    initLists();
    _processInbox();
    _checkPayments();
    writeLog({end: true});
  }
  catch(e){
    log.errors.push(arguments.callee.name + ' failed: ' + err2str(e));
    writeLog({end: true});
  }
  finally{
    if (constants.lock) constants.lock.releaseLock();
  }
}
