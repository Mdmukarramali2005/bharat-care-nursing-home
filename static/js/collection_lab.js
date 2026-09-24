const role = currentUser?.role || '';
const isCollectionRole = ['manager','cashier'].includes(role);
const isLabBillingRole = role === 'lab_cashier';
const isLabCollectionViewRole = role === 'manager';

// Holds the appointment currently opened by Token Number in the
// Lab Cashier's billing tool.
let currentLabAppointment = null;

// =====================================================
// CONSULTATION (DOCTOR FEE) COLLECTION — Cashier + Manager view
// Only the Cashier, and only for TODAY's date, can click Pending/Paid.
// =====================================================

async function loadCollectionDashboard() {
  if (!isCollectionRole) return;
  const date = document.getElementById('collectionDate')?.value || getTodayLocalDate();
  const doctorId = document.getElementById('collectionDoctor')?.value || '';
  let url = `/api/collections/doctors?date=${date}`;
  if (doctorId) url += `&doctor_id=${doctorId}`;
  const data = await apiRequest(url);
  if (!data.success) return;

  document.getElementById('collectionTotalBilling').textContent = `₹${data.summary.total_billing.toFixed(0)}`;
  document.getElementById('collectionPaid').textContent = `₹${data.summary.paid.toFixed(0)}`;
  document.getElementById('collectionPending').textContent = `₹${data.summary.pending.toFixed(0)}`;
  document.getElementById('collectionPatients').textContent = data.summary.total_patients;

  // Payment status can only be changed by the Cashier, and only when the
  // selected date is today. Every other view (Manager, or a past/future
  // date) is read-only.
  const canEditPayment = role === 'cashier' && date === getTodayLocalDate();

  const body = document.getElementById('collectionTableBody'); body.innerHTML='';
  data.appointments.forEach(a => {
    const tr=document.createElement('tr');
    const paymentCell = canEditPayment
      ? `<div class="payment-buttons">
           <button class="payment-btn pending ${a.payment_status==='pending'?'active':''}" onclick="setPaymentStatus(${a.id},'pending')">Pending</button>
           <button class="payment-btn paid ${a.payment_status==='paid'?'active':''}" onclick="setPaymentStatus(${a.id},'paid')">Paid</button>
         </div>`
      : `<span class="payment-btn ${a.payment_status==='paid'?'paid':'pending'} active" style="cursor:default;">${a.payment_status==='paid'?'Paid':'Pending'}</span>`;
    // Free Follow-up — the Cashier physically checks the doctor's paper
    // prescription and decides. Only editable by the Cashier, only for
    // today's date, and only while payment is still Pending.
    const canEditFreeFollowup = canEditPayment && a.payment_status !== 'paid';
    const typeCell = canEditFreeFollowup
      ? `<label class="free-followup-toggle" style="display:flex;align-items:center;gap:6px;cursor:pointer;">
           <input type="checkbox" ${a.is_free_followup ? 'checked' : ''} onchange="toggleFreeFollowup(${a.id}, this)">
           Free Follow-up
         </label>`
      : `${a.is_free_followup ? 'Free Follow-up' : 'New Visit'}`;
    tr.innerHTML=`<td>${a.token_number||'-'}</td><td>${a.patient_name}</td><td>${a.doctor_name}</td><td>${typeCell}</td><td>₹${Number(a.fee||0).toFixed(0)}</td><td>${paymentCell}</td>`;
    body.appendChild(tr);
  });

  const dbody=document.getElementById('doctorCollectionBody'); dbody.innerHTML='';
  data.doctor_summary.forEach(d=>{ const tr=document.createElement('tr'); tr.innerHTML=`<td>${d.doctor_name}</td><td>${d.patients}</td><td>₹${d.paid.toFixed(0)}</td><td>₹${d.pending.toFixed(0)}</td><td>₹${d.billing.toFixed(0)}</td>`; dbody.appendChild(tr); });
}

async function setPaymentStatus(id,status){
  const data=await apiRequest(`/api/collections/appointment/${id}/payment`,{method:'POST',body:JSON.stringify({status})});
  if(data?.success) {
    loadCollectionDashboard();
  } else if (data?.message) {
    alert(data.message);
  }
}

async function toggleFreeFollowup(id, checkboxEl) {
  const makeFree = checkboxEl.checked;

  let data = await apiRequest(`/api/collections/appointment/${id}/free-followup`, {
    method: 'POST',
    body: JSON.stringify({ free: makeFree })
  });

  if (data?.success) {
    loadCollectionDashboard();
    return;
  }

  if (data?.needs_confirmation) {
    if (confirm(data.message)) {
      data = await apiRequest(`/api/collections/appointment/${id}/free-followup`, {
        method: 'POST',
        body: JSON.stringify({ free: makeFree, confirm_no_match: true })
      });
    }
  }

  if (data?.success) {
    loadCollectionDashboard();
  } else {
    if (data?.message) alert(data.message);
    checkboxEl.checked = !makeFree; // revert the checkbox on cancel/failure
  }
}

// =====================================================
// LAB CASHIER — Token Number lookup + test selection (hard-copy prescription)
// =====================================================

async function lookupLabToken() {
  if (!isLabBillingRole) return;

  const token = (document.getElementById('labTokenNumber').value || '').trim().toUpperCase();
  const date = document.getElementById('labBillDate')?.value || getTodayLocalDate();
  if (!token) { alert('Enter a Token Number.'); return; }

  // Token lookup is intentionally different from the date-only list view:
  // BOTH selected date + token must match the same appointment.
  const data = await apiRequest(`/api/lab/patient-by-token?date=${encodeURIComponent(date)}&token=${encodeURIComponent(token)}`);
  if (!data.success) {
    alert(data.message || 'Token Number not found.');
    return;
  }

  const a = data.appointment;
  currentLabAppointment = {
    id: a.id,
    token_number: a.token_number,
    appointment_date: a.appointment_date
  };
  // Remember that the user is in single-patient/token-search mode.
  // loadLabBills() will show only this patient's bills until the date/doctor
  // filter is changed.
  window.labTokenSearchAppointmentId = a.id;
  window.labTokenSearchToken = a.token_number;

  document.getElementById('labDetailPatientName').textContent = a.patient_name || '-';
  document.getElementById('labDetailPatientAgeGender').textContent = `${a.patient_age || '-'}, ${a.patient_gender || '-'}`;
  document.getElementById('labDetailPatientPhone').textContent = a.patient_phone || '-';
  document.getElementById('labDetailDoctorName').textContent = a.doctor_name || '-';
  document.getElementById('labDetailDoctorSpecialty').textContent = a.doctor_specialty || '-';
  document.getElementById('labDetailAppointmentInfo').textContent = `${a.appointment_date} — ${a.time_slot} (Token: ${a.token_number})`;

  document.getElementById('labPatientDetails').style.display = 'block';
  document.getElementById('labBillingArea').style.display = 'block';

  await loadLabDashboard();
}

async function loadLabDashboard(){
  if(!isLabBillingRole) return;
  const data=await apiRequest('/api/lab/tests');
  if(!data.success) return;

  const box=document.getElementById('labTestList'); box.innerHTML='';
  data.tests.forEach(t=>{
    const row=document.createElement('label'); row.className='lab-test-item';
    row.innerHTML=`<span><input type="checkbox" value="${t.id}" data-fee="${t.fee}" data-name="${t.name}" onchange="recalculateLab()"> ${t.name}</span><strong>₹${Number(t.fee).toFixed(0)}</strong>`;
    box.appendChild(row);
  });
  recalculateLab();
}

function recalculateLab(){
  let total=0,count=0; document.querySelectorAll('#labTestList input:checked').forEach(x=>{total+=Number(x.dataset.fee||0);count++;});
  document.getElementById('labSelectedCount').textContent=count; document.getElementById('labTotal').textContent=`₹${total.toFixed(0)}`;
}

async function saveLabBill(){
  if (!isLabBillingRole) return;

  if (!currentLabAppointment) {
    alert('Open a patient by Token Number first.');
    return;
  }

  const testIds=[...document.querySelectorAll('#labTestList input:checked')].map(x=>Number(x.value));
  if(!testIds.length){alert('Select at least one test.');return;}

  const data=await apiRequest('/api/lab/bills',{
    method:'POST',
    body:JSON.stringify({
      appointment_id: currentLabAppointment.id,
      token_number: currentLabAppointment.token_number,
      test_ids: testIds
    })
  });

  if(data.success){
    alert(`Lab bill created for ${data.patient_name} (${data.token_number}). Total: ₹${data.total.toFixed(0)}`);

    document.getElementById('labTokenNumber').value = '';
    document.getElementById('labPatientDetails').style.display = 'none';
    document.getElementById('labBillingArea').style.display = 'none';
    currentLabAppointment = null;

    loadLabBills();
  } else {
    alert(data.message || 'Could not create the lab bill.');
  }
}


function clearLabTokenSearchMode() {
  window.labTokenSearchAppointmentId = null;
  window.labTokenSearchToken = null;
  currentLabAppointment = null;
  const details = document.getElementById('labPatientDetails');
  const billing = document.getElementById('labBillingArea');
  if (details) details.style.display = 'none';
  if (billing) billing.style.display = 'none';
  const token = document.getElementById('labTokenNumber');
  if (token) token.value = '';
}

// =====================================================
// LAB CASHIER — Lab Bills list, by date + doctor.
// Defaults to today's date and "All Doctors" (overall).
// Payment status (Pending/Paid) can only be changed by the Lab
// Cashier, and only when the selected date is today; any other
// date is view-only.
// =====================================================

async function loadLabBills(){
  if(!isLabBillingRole) return;

  const dateInput = document.getElementById('labBillDate');
  const doctorSelect = document.getElementById('labBillDoctor');
  const today = getTodayLocalDate();
  const date = dateInput?.value || today;
  const doctorId = doctorSelect?.value || '';

  let url = `/api/collections/lab?date=${date}`;
  if (doctorId) url += `&doctor_id=${doctorId}`;

  const data = await apiRequest(url);
  if (!data.success) return;

  // Date/doctor selection normally shows the complete list. When the user
  // explicitly searched Date + Token, show only that patient's bills.
  const tokenSearchId = window.labTokenSearchAppointmentId;
  const tokenSearchToken = window.labTokenSearchToken;
  const bills = tokenSearchId
    ? data.bills.filter(b => Number(b.appointment_id) === Number(tokenSearchId) || String(b.token_number || '').toUpperCase() === String(tokenSearchToken || '').toUpperCase())
    : data.bills;

  const displaySummary = tokenSearchId ? {
    total_bills: bills.length,
    total_billing: bills.reduce((n,b) => n + Number(b.total || 0), 0),
    paid: bills.reduce((n,b) => n + (b.payment_status === 'paid' ? Number(b.total || 0) : 0), 0)
  } : data.summary;
  displaySummary.pending = displaySummary.total_billing - displaySummary.paid;

  document.getElementById('labBillTotalBills').textContent = displaySummary.total_bills;
  document.getElementById('labBillTotalBilling').textContent = `₹${displaySummary.total_billing.toFixed(0)}`;
  document.getElementById('labBillPaid').textContent = `₹${displaySummary.paid.toFixed(0)}`;
  document.getElementById('labBillPending').textContent = `₹${displaySummary.pending.toFixed(0)}`;

  const doctorWiseTitle = document.getElementById('labBillDoctorWiseTitle');
  if (doctorWiseTitle) {
    doctorWiseTitle.textContent = doctorId ? 'Selected Doctor Total' : 'Doctor-wise Totals (All Doctors)';
  }

  const canEditPayment = date === today;

  const dbody = document.getElementById('labBillDoctorBody');
  if (dbody) {
    dbody.innerHTML = '';
    data.doctor_summary.forEach(d => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${d.doctor_name}</td><td>${d.bills}</td><td>₹${d.paid.toFixed(0)}</td><td>₹${d.pending.toFixed(0)}</td><td>₹${d.billing.toFixed(0)}</td>`;
      dbody.appendChild(tr);
    });
  }

  const body=document.getElementById('labBillsBody'); if(!body)return; body.innerHTML='';
  if (!bills.length) {
    body.innerHTML = `<tr><td colspan="7">No lab bills for this selection.</td></tr>`;
    return;
  }
  bills.forEach(b=>{
    const tr=document.createElement('tr');
    const paymentCell = canEditPayment
      ? `<div class="payment-buttons">
           <button class="payment-btn pending ${b.payment_status==='pending'?'active':''}" onclick="setLabPayment(${b.id},'pending')">Pending</button>
           <button class="payment-btn paid ${b.payment_status==='paid'?'active':''}" onclick="setLabPayment(${b.id},'paid')">Paid</button>
         </div>`
      : `<span class="payment-btn ${b.payment_status==='paid'?'paid':'pending'} active" style="cursor:default;">${b.payment_status==='paid'?'Paid':'Pending'}</span>`;
    tr.innerHTML=`<td>${b.id}</td><td>${b.token_number||'-'}</td><td>${b.patient_name}</td><td>${b.doctor_name||'-'}</td><td>${b.tests}</td><td>₹${Number(b.total).toFixed(0)}</td><td>${paymentCell}</td>`;
    body.appendChild(tr);
  });
}

async function setLabPayment(id,status){
  const d=await apiRequest(`/api/lab/bills/${id}/payment`,{method:'POST',body:JSON.stringify({status})});
  if(d.success) {
    loadLabBills();
  } else if (d?.message) {
    alert(d.message);
  }
}

// =====================================================
// LAB COLLECTION — Manager's read-only aggregate view
// (consultation + lab test fee, by date and by doctor)
// =====================================================

async function loadLabCollectionDashboard() {
  if (!isLabCollectionViewRole) return;

  const today = getTodayLocalDate();
  const date = document.getElementById('labCollectionDate')?.value || today;
  const doctorId = document.getElementById('labCollectionDoctor')?.value || '';
  const doctorParam = doctorId ? `&doctor_id=${doctorId}` : '';

  const labData = await apiRequest(`/api/collections/lab?date=${date}${doctorParam}`);
  if (!labData.success) return;

  document.getElementById('labCollTotalBills').textContent = labData.summary.total_bills;
  document.getElementById('labCollTotalBilling').textContent = `₹${labData.summary.total_billing.toFixed(0)}`;
  document.getElementById('labCollPaid').textContent = `₹${labData.summary.paid.toFixed(0)}`;
  document.getElementById('labCollPending').textContent = `₹${labData.summary.pending.toFixed(0)}`;
  document.getElementById('labCollTestPaidSelected').textContent = `₹${labData.summary.paid.toFixed(0)}`;

  const body = document.getElementById('labCollBillsBody'); body.innerHTML = '';
  labData.bills.forEach(b => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${b.token_number||'-'}</td><td>${b.patient_name}</td><td>${b.doctor_name}</td><td>${b.tests}</td><td>₹${Number(b.total).toFixed(0)}</td><td><span class="payment-btn ${b.payment_status==='paid'?'paid':'pending'} active" style="cursor:default;">${b.payment_status==='paid'?'Paid':'Pending'}</span></td>`;
    body.appendChild(tr);
  });

  const dbody = document.getElementById('labCollDoctorBody'); dbody.innerHTML = '';
  labData.doctor_summary.forEach(d => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${d.doctor_name}</td><td>${d.bills}</td><td>₹${d.paid.toFixed(0)}</td><td>₹${d.pending.toFixed(0)}</td><td>₹${d.billing.toFixed(0)}</td>`;
    dbody.appendChild(tr);
  });

  // Today's lab paid total (skip the extra call if the selected date is already today).
  let labTodayPaid = labData.summary.paid;
  if (date !== today) {
    const labTodayData = await apiRequest(`/api/collections/lab?date=${today}${doctorParam}`);
    labTodayPaid = labTodayData.success ? labTodayData.summary.paid : 0;
  }
  document.getElementById('labCollTestPaidToday').textContent = `₹${labTodayPaid.toFixed(0)}`;

  // Consultation fee paid for the same date/doctor selection (selected + today).
  const consultData = await apiRequest(`/api/collections/doctors?date=${date}${doctorParam}`);
  const consultPaidSelected = consultData.success ? consultData.summary.paid : 0;
  document.getElementById('labCollConsultPaidSelected').textContent = `₹${consultPaidSelected.toFixed(0)}`;

  let consultPaidToday = consultPaidSelected;
  if (date !== today) {
    const consultTodayData = await apiRequest(`/api/collections/doctors?date=${today}${doctorParam}`);
    consultPaidToday = consultTodayData.success ? consultTodayData.summary.paid : 0;
  }
  document.getElementById('labCollConsultPaidToday').textContent = `₹${consultPaidToday.toFixed(0)}`;
}

// =====================================================
// INITIAL LOAD
// =====================================================

document.addEventListener('DOMContentLoaded',()=>{
  // Consultation collection — defaults to today; Cashier/Manager can
  // browse other dates read-only.
  const c=document.getElementById('collectionDate');
  if(c){
    c.value=getTodayLocalDate();
    c.addEventListener('change', loadCollectionDashboard);
  }
  const cd=document.getElementById('collectionDoctor');
  if(cd) cd.addEventListener('change', loadCollectionDashboard);

  if(isCollectionRole && cd){
    apiRequest('/api/collections/doctors/list').then(d=>{
      if(d.success){
        d.doctors.forEach(x=>{const o=document.createElement('option');o.value=x.id;o.textContent=`${x.name} - ${x.specialty}`;cd.appendChild(o);});
      }
    });
  }

  // Lab Cashier's own Lab Bills list — defaults to today, "All Doctors".
  const lbd=document.getElementById('labBillDate');
  if(lbd){
    lbd.value=getTodayLocalDate();
    lbd.addEventListener('change', loadLabBills);
  }
  const lbdoc=document.getElementById('labBillDoctor');
  if(lbdoc) lbdoc.addEventListener('change', loadLabBills);

  if(isLabBillingRole && lbdoc){
    apiRequest('/api/collections/doctors/list').then(d=>{
      if(d.success){
        d.doctors.forEach(x=>{const o=document.createElement('option');o.value=x.id;o.textContent=`${x.name} - ${x.specialty}`;lbdoc.appendChild(o);});
      }
    });
  }

  // Manager's Lab Collection aggregate view — defaults to today.
  const lc=document.getElementById('labCollectionDate');
  if(lc){
    lc.value=getTodayLocalDate();
    lc.addEventListener('change', loadLabCollectionDashboard);
  }
  const lcd=document.getElementById('labCollectionDoctor');
  if(lcd) lcd.addEventListener('change', loadLabCollectionDashboard);

  if(isLabCollectionViewRole && lcd){
    apiRequest('/api/collections/doctors/list').then(d=>{
      if(d.success){
        d.doctors.forEach(x=>{const o=document.createElement('option');o.value=x.id;o.textContent=`${x.name} - ${x.specialty}`;lcd.appendChild(o);});
      }
    });
  }

  loadCollectionDashboard();
  loadLabBills();
  loadLabCollectionDashboard();
});


// Lab Cashier: date/doctor selection is LIST-ONLY. It must never open a
// particular patient's details. Token search is a separate explicit action.
document.addEventListener('DOMContentLoaded', () => {
  const labDate = document.getElementById('labBillDate');
  const labDoctor = document.getElementById('labBillDoctor');
  if (labDate) labDate.addEventListener('change', () => { clearLabTokenSearchMode(); loadLabBills(); });
  if (labDoctor) labDoctor.addEventListener('change', () => { clearLabTokenSearchMode(); loadLabBills(); });
});
