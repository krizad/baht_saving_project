// Google Apps Script for "โครงการฝากเงินวันละบาท"
// Sheet IDs
const SHEET_USER = 'user';
const SHEET_MEMBER = 'member';
const SHEET_DEPOSIT = 'deposit';

// Main entry point
function doGet(e) {
  return handleRequest(e);
}
function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  const action = (e.parameter.action || '').toLowerCase();
  let result = {};
  try {
    switch (action) {
      case 'login':
        result = login(e);
        break;
      case 'get_members':
        result = getMembers(e);
        break;
      case 'get_member':
        result = getMember(e);
        break;
      case 'add_member':
        result = addMember(e);
        break;
      case 'update_member':
        result = updateMember(e);
        break;
      case 'get_deposits':
        result = getDeposits(e);
        break;
      case 'deposit':
        result = deposit(e);
        break;
      case 'summary':
        result = summary(e);
        break;
      case 'undo_deposit':
        result = undoDeposit(e);
        break;
      default:
        result = { success: false, message: 'Invalid action' };
    }
  } catch (err) {
    result = { success: false, message: err.message };
  }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

// 1. Login
function login(e) {
  const username = e.parameter.username;
  const password = e.parameter.password; // base64 encoded
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_USER);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] == username && data[i][1] == password) {
      // --- Generate sessionId and store in Cache ---
      const sessionId = Utilities.getUuid();
      const cache = CacheService.getScriptCache();
      cache.put(sessionId, username, 3600); // 1 hour
      return { success: true, name: data[i][2], surname: data[i][3], sessionId };
    }
  }
  return { success: false, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' };
}

// --- Require Auth Helper ---
function requireAuth(e) {
  const sessionId = e.parameter.sessionId;
  if (!sessionId) throw new Error('Unauthorized: sessionId required');
  const cache = CacheService.getScriptCache();
  const username = cache.get(sessionId);
  if (!username) throw new Error('Unauthorized: invalid session');
  return username;
}

// 2. Get all members (with search)
function getMembers(e) {
  requireAuth(e);
  const search = (e.parameter.search || '').toLowerCase();
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_MEMBER);
  const data = sheet.getDataRange().getValues();
  let members = [];
  for (let i = 1; i < data.length; i++) {
    const [id, moo, name, dob, regdate, status, carry, note] = data[i];
    if (
      !search ||
      id.toString().includes(search) ||
      (name && name.toLowerCase().includes(search))
    ) {
      members.push({
        id, moo, name, dob, regdate, status, carry, note
      });
    }
  }
  return { success: true, members };
}

// 3. Get member by id
function getMember(e) {
  requireAuth(e);
  const id = e.parameter.id;
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_MEMBER);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] == id) {
      const [id, moo, name, dob, regdate, status, carry, note] = data[i];
      // Calculate age
      const age = calcAge(dob);
      const memberAge = calcAge(regdate);
      return {
        success: true,
        member: { id, moo, name, dob, regdate, status, carry, note, age, memberAge }
      };
    }
  }
  return { success: false, message: 'ไม่พบสมาชิก' };
}

// 4. Add member
function addMember(e) {
  requireAuth(e);
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_MEMBER);
  const values = [
    e.parameter.id,
    e.parameter.moo,
    e.parameter.name,
    e.parameter.dob,
    e.parameter.regdate,
    e.parameter.status,
    e.parameter.carry,
    e.parameter.note
  ];
  sheet.appendRow(values);
  return { success: true, message: 'เพิ่มสมาชิกสำเร็จ' };
}

// 5. Update member
function updateMember(e) {
  requireAuth(e);
  const id = e.parameter.id;
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_MEMBER);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] == id) {
      sheet.getRange(i + 1, 2, 1, 7).setValues([[
        e.parameter.moo,
        e.parameter.name,
        e.parameter.dob,
        e.parameter.regdate,
        e.parameter.status,
        e.parameter.carry,
        e.parameter.note
      ]]);
      return { success: true, message: 'บันทึกข้อมูลสำเร็จ' };
    }
  }
  return { success: false, message: 'ไม่พบสมาชิก' };
}

// 6. Get deposits by month/year (return all members and deposit status for the month)
function getDeposits(e) {
  requireAuth(e);
  const monthYear = e.parameter.monthYear; // e.g. "01/2024"
  const sheetMember = SpreadsheetApp.getActive().getSheetByName(SHEET_MEMBER);
  const sheetDeposit = SpreadsheetApp.getActive().getSheetByName(SHEET_DEPOSIT);
  const memberData = sheetMember.getDataRange().getValues();
  const depositData = sheetDeposit.getDataRange().getValues();
  // Normalize monthYear for comparison (always MM/YYYY)
  function normalizeMonthYear(val) {
    if (!val) return '';
    if (typeof val === 'string' && val.includes('/')) {
      let [mm, yyyy] = val.split('/');
      mm = mm.padStart(2, '0');
      return mm + '/' + yyyy;
    }
    // If val is a Date object
    if (Object.prototype.toString.call(val) === '[object Date]' && !isNaN(val.getTime())) {
      let mm = (val.getMonth() + 1).toString().padStart(2, '0');
      let yyyy = val.getFullYear();
      return mm + '/' + yyyy;
    }
    // If val is not string, try toString
    if (typeof val !== 'string') val = String(val);
    // Try parse as Date string
    var d = new Date(val);
    if (!isNaN(d.getTime())) {
      let mm = (d.getMonth() + 1).toString().padStart(2, '0');
      let yyyy = d.getFullYear();
      return mm + '/' + yyyy;
    }
    return val;
  }
  const normMonthYear = normalizeMonthYear(monthYear);
  // Build deposit status map for this monthYear
  const depositedMap = {};
  for (let i = 1; i < depositData.length; i++) {
    // Use strict equality for id and monthYear, but treat id as string always
    const depositId = String(depositData[i][0]);
    const depositMonthYear = normalizeMonthYear(depositData[i][1]);
    if (depositMonthYear === normMonthYear) {
      depositedMap[depositId] = true;
    }
  }
  // Build members with deposit status
  let members = [];
  for (let i = 1; i < memberData.length; i++) {
    const [id, moo, name, dob, regdate, status, carry, note] = memberData[i];
    members.push({
      id, moo, name, dob, regdate, status, carry, note,
      deposited: !!depositedMap[String(id)]
    });
  }
  return { success: true, members };
}

// 7. Deposit for a member
function deposit(e) {
  requireAuth(e);
  const id = e.parameter.id;
  const monthYear = e.parameter.monthYear;
  const days = daysInMonth(monthYear);
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_DEPOSIT);
  const data = sheet.getDataRange().getValues();
  // Check if already deposited
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] == id && data[i][1] == monthYear) {
      return { success: false, message: 'ฝากเงินแล้ว' };
    }
  }
  sheet.appendRow([id, monthYear, days]);
  return { success: true, message: 'ฝากเงินสำเร็จ', amount: days };
}

// 8. Undo deposit for a member (delete deposit row)
function undoDeposit(e) {
  requireAuth(e);
  const id = e.parameter.id;
  const monthYear = e.parameter.monthYear;
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_DEPOSIT);
  const data = sheet.getDataRange().getValues();
  // Normalize monthYear for comparison (always MM/YYYY)
  function normalizeMonthYear(val) {
    if (!val) return '';
    if (typeof val === 'string' && val.includes('/')) {
      let [mm, yyyy] = val.split('/');
      mm = mm.padStart(2, '0');
      return mm + '/' + yyyy;
    }
    if (Object.prototype.toString.call(val) === '[object Date]' && !isNaN(val.getTime())) {
      let mm = (val.getMonth() + 1).toString().padStart(2, '0');
      let yyyy = val.getFullYear();
      return mm + '/' + yyyy;
    }
    if (typeof val !== 'string') val = String(val);
    var d = new Date(val);
    if (!isNaN(d.getTime())) {
      let mm = (d.getMonth() + 1).toString().padStart(2, '0');
      let yyyy = d.getFullYear();
      return mm + '/' + yyyy;
    }
    return val;
  }
  const normMonthYear = normalizeMonthYear(monthYear);
  for (let i = 1; i < data.length; i++) {
    const depositId = String(data[i][0]);
    const depositMonthYear = normalizeMonthYear(data[i][1]);
    if (depositId === String(id) && depositMonthYear === normMonthYear) {
      sheet.deleteRow(i + 1); // +1 because sheet is 1-based and skip header
      return { success: true, message: 'ยกเลิกรายการฝากเงินสำเร็จ' };
    }
  }
  return { success: false, message: 'ไม่พบรายการฝากเงินนี้' };
}

// 9. Summary by month
function summary(e) {
  requireAuth(e);
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_DEPOSIT);
  const data = sheet.getDataRange().getValues();
  // --- รวมยอดยกมาทั้งหมด ---
  const sheetMember = SpreadsheetApp.getActive().getSheetByName(SHEET_MEMBER);
  const memberData = sheetMember.getDataRange().getValues();
  let carryTotal = 0;
  for (let i = 1; i < memberData.length; i++) {
    const carry = Number(memberData[i][6]); // index 6 = ยอดยกมา
    if (!isNaN(carry)) carryTotal += carry;
  }
  let summary = {};
  let total = 0;
  for (let i = 1; i < data.length; i++) {
    const monthYear = data[i][1];
    const amount = Number(data[i][2]);
    if (!summary[monthYear]) summary[monthYear] = 0;
    summary[monthYear] += amount;
    total += amount;
  }
  let result = [];
  // เพิ่มยอดยกมาเป็นรายการแรก
  result.push({ monthYear: 'ยอดยกมา', total: carryTotal });
  for (let k in summary) {
    result.push({ monthYear: k, total: summary[k] });
  }
  return { success: true, summary: result, total: total + carryTotal };
}

// Helper: Calculate age from date string (yyyy-mm-dd)
function calcAge(dateStr) {
  if (!dateStr) return '';
  const today = new Date();
  const dob = new Date(dateStr);
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

// Helper: Days in month from "MM/YYYY"
function daysInMonth(monthYear) {
  if (!monthYear) return 0;
  const [mm, yyyy] = monthYear.split('/');
  return new Date(Number(yyyy), Number(mm), 0).getDate();
}