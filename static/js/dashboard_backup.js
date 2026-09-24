// =========================================
// BHARAT CARE - DOCTOR & STAFF DASHBOARD
// =========================================

const API_BASE = "";

const token = localStorage.getItem("carepulse_token");

const currentUser = JSON.parse(
    localStorage.getItem("carepulse_user") || "null"
);


// =========================================
// ELEMENTS
// =========================================

const dashboardUserName =
    document.getElementById("dashboardUserName");

const dashboardUserRole =
    document.getElementById("dashboardUserRole");

const dashboardDate =
    document.getElementById("dashboardDate");

const doctorFilterSection =
    document.getElementById("doctorFilterSection");

const doctorSelect =
    document.getElementById("doctorSelect");

const totalBookings =
    document.getElementById("totalBookings");

const completedOPD =
    document.getElementById("completedOPD");

const pendingOPD =
    document.getElementById("pendingOPD");

const vacantSeats =
    document.getElementById("vacantSeats");

const slotsContainer =
    document.getElementById("slotsContainer");

const selectedDoctorTitle =
    document.getElementById("selectedDoctorTitle");

const patientsTableBody =
    document.getElementById("patientsTableBody");

const patientListCount =
    document.getElementById("patientListCount");

const loadingOverlay =
    document.getElementById("loadingOverlay");

const logoutBtn =
    document.getElementById("logoutBtn");


// =========================================
// LOGIN CHECK
// =========================================

if (
    !token ||
    !currentUser ||
    !["doctor", "manager", "cashier", "lab_cashier"].includes(currentUser.role)
) {
    alert("Please login as Doctor or Manager.");

    window.location.href = "/";
}


// =========================================
// INITIALIZE USER
// =========================================

dashboardUserName.textContent =
    currentUser.name;

dashboardUserRole.textContent =
    currentUser.role;

// Role-specific dashboard visibility
const collectionSection = document.getElementById("collectionDashboardSection");
const labSection = document.getElementById("labDashboardSection");
const labCollectionSection = document.getElementById("labCollectionDashboardSection");
const doctorSections = [
    document.querySelector(".dashboard-title"),
    document.querySelector(".summary-grid"),
    document.getElementById("doctorFilterSection"),
    ...document.querySelectorAll(".doctor-opd-section")
];

const reviewsSection = document.querySelector(".reviews-dashboard-section");

if (currentUser.role === "cashier") {
    doctorSections.forEach(el => { if (el) el.style.display = "none"; });
    if (labSection) labSection.style.display = "none";
    if (labCollectionSection) labCollectionSection.style.display = "none";
    if (reviewsSection) reviewsSection.style.display = "none";
}

if (currentUser.role === "lab_cashier") {
    doctorSections.forEach(el => { if (el) el.style.display = "none"; });
    if (collectionSection) collectionSection.style.display = "none";
    if (labCollectionSection) labCollectionSection.style.display = "none";
    if (reviewsSection) reviewsSection.style.display = "none";
}

if (currentUser.role === "doctor") {
    if (doctorFilterSection) doctorFilterSection.style.display = "none";
    if (collectionSection) collectionSection.style.display = "none";
    if (labSection) labSection.style.display = "none";
    if (labCollectionSection) labCollectionSection.style.display = "none";
}

if (currentUser.role === "manager") {
    // Manager can view consultation collection (read-only) and the
    // aggregate lab collection view, but not the lab billing tool
    // itself (opening a token, selecting tests, creating a bill).
    if (labSection) labSection.style.display = "none";
}


// =========================================
// SET TODAY'S DATE
// =========================================

function getTodayLocalDate() {

    const now = new Date();

    const year = now.getFullYear();

    const month =
        String(now.getMonth() + 1)
        .padStart(2, "0");

    const day =
        String(now.getDate())
        .padStart(2, "0");

    return `${year}-${month}-${day}`;
}


dashboardDate.value =
    getTodayLocalDate();


// =========================================
// API REQUEST HELPER
// =========================================

async function apiRequest(url, options = {}) {

    const headers = {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(options.headers || {})
    };

    const response = await fetch(
        `${API_BASE}${url}`,
        {
            ...options,
            headers
        }
    );

    const data =
        await response.json();

    if (!response.ok) {

        if (
            response.status === 401 ||
            response.status === 403
        ) {

            alert(
                data.message ||
                "Session expired. Please login again."
            );

            localStorage.removeItem("carepulse_token");

            localStorage.removeItem("carepulse_user");

            

            window.location.href = "/";

            return;
        }

        throw new Error(
            data.message ||
            "Something went wrong."
        );
    }

    return data;
}


// =========================================
// LOADING
// =========================================

function showLoading() {

    loadingOverlay.classList.add("show");
}


function hideLoading() {

    loadingOverlay.classList.remove("show");
}


// =========================================
// GET SELECTED DOCTOR
// =========================================

function getSelectedDoctorId() {

    if (
        currentUser.role === "doctor"
    ) {

        return currentUser.doctor_id;
    }

    return doctorSelect.value;
}


// =========================================
// LOAD DASHBOARD STATS
// =========================================

async function loadStats() {

    const selectedDate =
        dashboardDate.value;

    const data =
        await apiRequest(
            `/api/dashboard/stats?date=${selectedDate}`
        );

    if (!data.success) {
        return;
    }

    totalBookings.textContent =
        data.summary.total_bookings;

    completedOPD.textContent =
        data.summary.completed;

    pendingOPD.textContent =
        data.summary.pending;

    vacantSeats.textContent =
        data.summary.vacant;

    // Manager doctor dropdown
    if (
        currentUser.role === "manager"
    ) {

        const currentValue =
            doctorSelect.value;

        doctorSelect.innerHTML = "";

        data.doctor_summaries.forEach(
            (item) => {

                const option =
                    document.createElement("option");

                option.value =
                    item.doctor.id;

                option.textContent =
                    `${item.doctor.name} - ${item.doctor.specialty}`;

                doctorSelect.appendChild(
                    option
                );
            }
        );

        if (
            currentValue
        ) {

            doctorSelect.value =
                currentValue;
        }
    }

    // Doctor title
    if (
        currentUser.role === "doctor"
    ) {

        const doctorSummary =
            data.doctor_summaries[0];

        if (doctorSummary) {

            selectedDoctorTitle.textContent =
                `${doctorSummary.doctor.name} - ${doctorSummary.doctor.specialty}`;
        }
    }
}


// =========================================
// LOAD SLOT STATUS
// =========================================

async function loadSlots() {

    const selectedDate =
        dashboardDate.value;

    const doctorId =
        getSelectedDoctorId();

    if (!doctorId) {

        slotsContainer.innerHTML =
            `<p class="loading-text">
                Please select a doctor.
            </p>`;

        return;
    }

    const data =
        await apiRequest(
            `/api/dashboard/slots?date=${selectedDate}&doctor_id=${doctorId}`
        );

    if (!data.success) {
        return;
    }

    selectedDoctorTitle.textContent =
        `${data.doctor.name} - ${data.doctor.specialty}`;

    slotsContainer.innerHTML = "";

    data.slots.forEach(
        (slot) => {

            const percentage =
                (slot.booked / slot.capacity) * 100;

            const statusText =
                slot.is_full
                    ? "Full"
                    : "Available";

            const statusClass =
                slot.is_full
                    ? "full"
                    : "available";

            const card =
                document.createElement("div");

            card.className =
                `slot-card ${
                    slot.is_full
                        ? "full"
                        : ""
                }`;

            card.innerHTML = `
                <h3>${slot.slot}</h3>

                <div class="slot-numbers">

                    <div class="slot-number-box">

                        <span>Booked</span>

                        <strong>
                            ${slot.booked}
                            /
                            ${slot.capacity}
                        </strong>

                    </div>


                    <div class="slot-number-box">

                        <span>Vacant</span>

                        <strong>
                            ${slot.vacant}
                        </strong>

                    </div>


                    <div class="slot-number-box">

                        <span>Completed</span>

                        <strong>
                            ${slot.completed}
                        </strong>

                    </div>


                    <div class="slot-number-box">

                        <span>Pending</span>

                        <strong>
                            ${slot.pending}
                        </strong>

                    </div>

                </div>


                <div class="slot-progress">

                    <div
                        class="slot-progress-bar"
                        style="width: ${percentage}%">
                    </div>

                </div>


                <span
                    class="slot-status ${statusClass}">

                    ${statusText}

                </span>
            `;

            slotsContainer.appendChild(
                card
            );
        }
    );
}


// =========================================
// LOAD PATIENTS
// =========================================

async function loadPatients() {

    const selectedDate = dashboardDate.value;
    const doctorId = getSelectedDoctorId();

    let url = `/api/dashboard/patients?date=${selectedDate}`;
    if (doctorId) url += `&doctor_id=${doctorId}`;

    const data = await apiRequest(url);
    if (!data.success) return;

    // Today's Patients is now the single source of truth for
    // token, live queue, fee and follow-up management.
    let queueData = { queue: [] };
    try {
        let queueUrl = `/api/dashboard/queue?date=${selectedDate}`;
        if (doctorId) queueUrl += `&doctor_id=${doctorId}`;
        queueData = await apiRequest(queueUrl);
    } catch (e) {
        console.error("Queue load failed:", e);
    }

    const queueById = {};
    (queueData.queue || []).forEach(item => {
        queueById[item.id] = item;
    });

    patientsTableBody.innerHTML = "";
    patientListCount.textContent = data.patients.length;

    if (!data.patients.length) {
        patientsTableBody.innerHTML = `
            <tr>
                <td colspan="13" class="empty-row">No appointments found.</td>
            </tr>`;
        updateTodaysCollection([]);
        return;
    }

    data.patients.forEach((patient, index) => {
        const q = queueById[patient.id] || patient;

        const currentStatus = q.queue_status || "waiting";
        const statuses = ["waiting", "called", "completed", "no_show"];

        const statusButtons = statuses.map(status => `
            <button type="button"
                class="queue-status-btn queue-${status.replaceAll("_", "-")} ${currentStatus === status ? "active" : ""}"
                onclick="updateQueueStatus(${patient.id}, '${status}')">
                ${status === "no_show" ? "No Show" : status.charAt(0).toUpperCase() + status.slice(1)}
            </button>
        `).join("");

        const feeHtml = q.is_free_followup
            ? `<strong>₹0</strong><br><small class="free-followup-label">Free Follow-up</small>`
            : `<strong>₹${Number(q.fee ?? patient.fee ?? 0).toFixed(0)}</strong><br><small>New Visit</small>`;

        // Consultation payment status — set only by the front-desk Cashier
        // (for today's date only). Doctor and Manager can only view it.
        const consultStatus = (q.payment_status || patient.payment_status || "pending");
        const consultStatusHtml =
            `<span class="payment-btn ${consultStatus === "paid" ? "paid" : "pending"} active" style="cursor:default;display:inline-block;">
                ${consultStatus === "paid" ? "Paid" : "Pending"}
            </span>`;

        // Lab test payment status — set only by the Lab Cashier, after a
        // bill has been generated for this patient's token number.
        const labStatusHtml = q.lab_payment_status
            ? `<span class="payment-btn ${q.lab_payment_status === "paid" ? "paid" : "pending"} active" style="cursor:default;display:inline-block;">
                    ${q.lab_payment_status === "paid" ? "Paid" : "Pending"} (₹${Number(q.lab_total || 0).toFixed(0)})
               </span>`
            : `<span class="lab-not-billed">No Lab Bill Yet</span>`;

        // Doctor writes the tests-required prescription; everyone else
        // (Manager) can only view what was written.
        const prescriptionText = q.prescribed_tests
            ? q.prescribed_tests
            : "<em>Not written</em>";
        const prescriptionHtml = currentUser.role === "doctor"
            ? `<div class="prescription-cell">
                    <div class="prescription-text">${prescriptionText}</div>
                    <button type="button" class="complete-btn" style="margin-top:4px;font-size:12px;padding:4px 8px;"
                        onclick='writePrescription(${patient.id}, ${JSON.stringify(q.prescribed_tests || "")})'>
                        ${q.prescribed_tests ? "Edit" : "Write"} Prescription
                    </button>
               </div>`
            : `<div class="prescription-text">${prescriptionText}</div>`;

        const row = document.createElement("tr");

        row.innerHTML = `
            <td>${index + 1}</td>

            <td>
                <strong class="patient-token">${q.token_number || "-"}</strong>
            </td>

            <td>
                <strong>${patient.patient_name || "-"}</strong>
            </td>

            <td>${patient.patient_age || "-"}</td>

            <td>${patient.patient_gender || "-"}</td>

            <td>${patient.time_slot || "-"}</td>

            <td>${patient.reason || "-"}</td>

            <td>
                <div class="queue-status-buttons">
                    ${statusButtons}
                </div>
            </td>

            <td>${feeHtml}</td>

            <td>${consultStatusHtml}</td>

            <td>${prescriptionHtml}</td>

            <td>${labStatusHtml}</td>

            <td>
                <div id="today-followup-${patient.id}" class="followup-buttons loading">
                    Loading...
                </div>
                <small id="today-followup-label-${patient.id}">
                    ${q.follow_up_date ? `Set: ${q.follow_up_date}` : "Choose an option"}
                </small>
            </td>

            <td>${patient.doctor_name || "-"}</td>

            <td>${patient.patient_phone || "-"}</td>

            <td>
                ${patient.status === "completed"
                    ? `<span class="done-text">✓ Done</span>`
                    : `<button class="complete-btn" onclick="markCompleted(${patient.id})">Mark OPD Done</button>`
                }
            </td>
        `;

        patientsTableBody.appendChild(row);
        loadTodayFollowUpButtons(patient.id, patient.doctor_specialty || q.specialty || "");
    });

    updateTodaysCollection(data.patients.map(p => queueById[p.id] || p));
    updateFeeTotals(queueData.totals);
}

async function writePrescription(appointmentId, existingText) {
    const input = window.prompt(
        "Tests Required (comma separated), e.g. CBC, KFT, Urine Routine:",
        existingText || ""
    );

    if (input === null) return;

    const tests = input.split(",").map(t => t.trim()).filter(Boolean);

    if (!tests.length) {
        alert("Enter at least one test name.");
        return;
    }

    const data = await apiRequest(
        `/api/dashboard/appointment/${appointmentId}/prescription`,
        { method: "POST", body: JSON.stringify({ tests }) }
    );

    if (data?.success) loadPatients();
}

function updateFeeTotals(totals) {
    if (!totals) return;

    let el = document.getElementById("doctorFeeTotals");

    if (!el) {
        el = document.createElement("div");
        el.id = "doctorFeeTotals";
        el.className = "today-collection-summary";

        const tableWrapper = patientsTableBody.closest(".table-wrapper");
        if (tableWrapper && tableWrapper.parentElement) {
            tableWrapper.parentElement.appendChild(el);
        }
    }

    el.innerHTML = `
        <strong>Total Consultant Fee:</strong> ₹${Number(totals.total_consultation_fee_paid || 0).toFixed(0)}
        &nbsp;&nbsp;&nbsp;
        <strong>Total Test Fee:</strong> ₹${Number(totals.total_test_fee_paid || 0).toFixed(0)}
    `;
}

function updateTodaysCollection(patients) {
    const total = patients.reduce((sum, p) => {
        return sum + Number(p.fee || 0);
    }, 0);

    let existing = document.getElementById("todayCollectionSummary");
    if (!existing) {
        existing = document.createElement("div");
        existing.id = "todayCollectionSummary";
        existing.className = "today-collection-summary";

        const tableWrapper = patientsTableBody.closest(".table-wrapper");
        if (tableWrapper && tableWrapper.parentElement) {
            tableWrapper.parentElement.appendChild(existing);
        }
    }

    const newVisitTotal = patients
        .filter(p => !Number(p.is_free_followup))
        .reduce((sum, p) => sum + Number(p.fee || 0), 0);

    const freeFollowups = patients.filter(p => Number(p.is_free_followup)).length;

    existing.innerHTML = `
        <div>
            <span>New Consultations</span>
            <strong>₹${newVisitTotal.toFixed(0)}</strong>
        </div>
        <div>
            <span>Free Follow-ups</span>
            <strong>₹0 <small>(${freeFollowups})</small></strong>
        </div>
        <div class="collection-total">
            <span>Today's Total</span>
            <strong>₹${total.toFixed(0)}</strong>
        </div>
    `;
}

async function loadTodayFollowUpButtons(id, department) {
    const container = document.getElementById(`today-followup-${id}`);
    if (!container) return;

    try {
        const data = await apiRequest(
            `/api/follow-up/options?department=${encodeURIComponent(department)}`,
            { headers: {} }
        );

        const options = (data.options || []).slice(0, 4);
        container.classList.remove("loading");

        if (!options.length) {
            container.innerHTML = `<small>No follow-up options</small>`;
            return;
        }

        container.innerHTML = options.map((opt, index) => {
            const isNoFollow = !opt.interval_days || /no follow/i.test(opt.label || "");
            const label = opt.label || (isNoFollow ? "No Follow-up" : `After ${opt.interval_days} Days`);

            return `
                <button type="button"
                    class="followup-btn ${isNoFollow ? "followup-none" : ""}"
                    onclick="setFollowUpFromToday(${id}, ${index}, '${String(department).replaceAll("'", "\\'")}')">
                    ${label}
                </button>`;
        }).join("");

    } catch (e) {
        container.classList.remove("loading");
        container.innerHTML = `<small>Unable to load options</small>`;
        console.error(e);
    }
}

async function setFollowUpFromToday(id, optionIndex, department) {
    try {
        const data = await apiRequest(
            `/api/follow-up/options?department=${encodeURIComponent(department)}`,
            { headers: {} }
        );

        const opt = (data.options || [])[optionIndex];
        if (!opt) throw new Error("Follow-up option not found.");

        const isNoFollow = !opt.interval_days || /no follow/i.test(opt.label || "");

        const payload = isNoFollow
            ? {
                no_follow_up: true,
                category: opt.label || "No Follow-up",
                do_not_disturb: true
            }
            : {
                interval_days: opt.interval_days,
                category: department + " Follow-up",
                do_not_disturb: false
            };

        const result = await apiRequest(
            `/api/dashboard/appointment/${id}/follow-up`,
            {
                method: "POST",
                body: JSON.stringify(payload)
            }
        );

        const label = document.getElementById(`today-followup-label-${id}`);
        if (label) {
            label.textContent = result.follow_up_date
                ? `Set: ${result.follow_up_date}`
                : "No automated follow-up";
        }

        await loadPatients();

    } catch (e) {
        alert(e.message);
    }
}

window.setFollowUpFromToday = setFollowUpFromToday;


// =========================================
// MARK OPD COMPLETED
// =========================================

async function markCompleted(
    appointmentId
) {

    const confirmed =
        confirm(
            "Mark this patient's OPD as completed?"
        );

    if (!confirmed) {
        return;
    }

    try {

        showLoading();

        const data =
            await apiRequest(
                `/api/dashboard/appointment/${appointmentId}/complete`,
                {
                    method: "POST"
                }
            );

        alert(
            data.message ||
            "OPD completed successfully."
        );

        await loadDashboard();

    } catch (error) {

        alert(
            error.message
        );

    } finally {

        hideLoading();
    }
}


// Make function available to HTML buttons
window.markCompleted =
    markCompleted;




// =========================================================
// LIVE QUEUE + FOLLOW-UP
// =========================================================
const queueTableBody = document.getElementById("queueTableBody");

async function loadQueue() {
    if (!queueTableBody) return;
    const doctorId = getSelectedDoctorId();
    if (!doctorId) return;
    const date = dashboardDate.value;
    try {
        const data = await apiRequest(`/api/dashboard/queue?date=${date}&doctor_id=${doctorId}`);
        queueTableBody.innerHTML = "";
        if (!data.queue.length) {
            queueTableBody.innerHTML = `<tr><td colspan="7" class="empty-row">No patients in today's queue.</td></tr>`;
            return;
        }

        data.queue.forEach(p => {
            const row = document.createElement("tr");
            const fee = p.is_free_followup
                ? `<strong>₹0</strong><br><small>Free follow-up</small>`
                : `₹${Number(p.fee || 0).toFixed(0)}`;
            const follow = p.follow_up_date
                ? `${p.follow_up_category || "Follow-up"}<br><small>${p.follow_up_date}</small>`
                : "Not set";

            const statuses = ["waiting", "called", "completed", "no_show"];
            const currentStatus = p.queue_status || "waiting";
            const statusButtons = statuses.map(status => `
                <button type="button"
                        class="queue-status-btn queue-${status.replaceAll("_", "-")} ${currentStatus === status ? "active" : ""}"
                        onclick="updateQueueStatus(${p.id}, '${status}')">
                    ${status === "no_show" ? "No Show" : status.charAt(0).toUpperCase() + status.slice(1)}
                </button>
            `).join("");

            row.innerHTML = `
                <td><strong>${p.token_number || "-"}</strong></td>
                <td>${p.patient_name || "-"}</td>
                <td>${p.time_slot || "-"}</td>
                <td><div class="queue-status-buttons">${statusButtons}</div></td>
                <td>${fee}</td>
                <td><div id="followup-${p.id}" class="followup-buttons loading">Loading...</div></td>
                <td><small>${p.follow_up_date ? "Follow-up set" : "Select an option"}</small></td>`;
            queueTableBody.appendChild(row);
            loadFollowUpButtons(p.id, p.specialty || "");
        });
    } catch (e) { console.error(e); }
}

async function updateQueueStatus(id, status) {
    try {
        await apiRequest(`/api/dashboard/queue/${id}/status`, {
            method: "POST",
            body: JSON.stringify({status})
        });
        await loadQueue();
        await loadPatients();
    } catch (e) { alert(e.message); }
}
window.updateQueueStatus = updateQueueStatus;

async function loadFollowUpButtons(id, department) {
    const container = document.getElementById(`followup-${id}`);
    if (!container) return;
    try {
        const data = await apiRequest(`/api/follow-up/options?department=${encodeURIComponent(department)}`, {headers:{}});
        const options = (data.options || []).slice(0, 4);
        container.classList.remove("loading");
        if (!options.length) {
            container.innerHTML = `<small>No follow-up options</small>`;
            return;
        }
        container.innerHTML = options.map((opt, index) => {
            const isNoFollow = !opt.interval_days || /no follow/i.test(opt.label || "");
            const label = opt.label || (isNoFollow ? "No Follow-up" : `After ${opt.interval_days} Days`);
            return `<button type="button" class="followup-btn ${isNoFollow ? "followup-none" : ""}"
                        onclick="setFollowUpDirect(${id}, ${index}, '${String(department).replaceAll("'", "\\'")}')">
                        ${label}
                    </button>`;
        }).join("");
    } catch (e) {
        container.classList.remove("loading");
        container.innerHTML = `<small>Unable to load options</small>`;
        console.error(e);
    }
}

async function setFollowUpDirect(id, optionIndex, department) {
    try {
        const data = await apiRequest(`/api/follow-up/options?department=${encodeURIComponent(department)}`, {headers:{}});
        const opt = (data.options || [])[optionIndex];
        if (!opt) throw new Error("Follow-up option not found.");

        const isNoFollow = !opt.interval_days || /no follow/i.test(opt.label || "");
        const payload = isNoFollow
            ? {no_follow_up: true, category: opt.label || "No Follow-up", do_not_disturb: true}
            : {interval_days: opt.interval_days, category: department + " Follow-up", do_not_disturb: false};

        await apiRequest(`/api/dashboard/appointment/${id}/follow-up`, {
            method: "POST",
            body: JSON.stringify(payload)
        });
        await loadQueue();
    } catch(e) { alert(e.message); }
}
window.setFollowUpDirect = setFollowUpDirect;
// Kept for compatibility with any older dashboard markup.
window.openFollowUp = function() {};


// =========================================
// LOAD EVERYTHING
// =========================================

async function loadDashboard() {

    // Cashier and Lab Cashier use their dedicated dashboards.
    // Do not call doctor/OPD endpoints for these roles.
    if (["cashier", "lab_cashier"].includes(currentUser?.role)) {
        return;
    }

    try {

        showLoading();

        await loadStats();

        await loadSlots();

        await loadPatients();
        await loadQueue();

    } catch (error) {

        console.error(error);

        alert(
            error.message ||
            "Failed to load dashboard."
        );

    } finally {

        hideLoading();
    }
}


// =========================================
// EVENTS
// =========================================

dashboardDate.addEventListener(
    "change",
    async () => {

        await loadDashboard();
    }
);


doctorSelect.addEventListener(
    "change",
    async () => {

        await loadSlots();

        await loadPatients();
        await loadQueue();
    }
);


logoutBtn.addEventListener(
    "click",
    () => {

        localStorage.removeItem("carepulse_token");

        localStorage.removeItem("carepulse_user");

        window.location.href = "/";
    }
);


// =========================================
// START DASHBOARD
// =========================================

loadDashboard();


// =========================================================
// PATIENT REVIEWS MANAGEMENT
// =========================================================


const dashboardReviewsContainer =
    document.getElementById(
        "dashboardReviewsContainer"
    );


const pendingReviewsCount =
    document.getElementById(
        "pendingReviewsCount"
    );


// =========================================================
// LOAD REVIEWS
// =========================================================

async function loadDashboardReviews() {

    if (!dashboardReviewsContainer) {
        return;
    }

    // Patient Reviews management is a doctor/manager function only.
    // Cashier and Lab Cashier do not have access to this endpoint.
    if (!["doctor", "manager"].includes(currentUser?.role)) {
        return;
    }

    dashboardReviewsContainer.innerHTML = `
        <div class="dashboard-review-loading">
            <i class="fa-solid fa-spinner fa-spin"></i>
            Loading patient reviews...
        </div>
    `;


    try {

        const data =
            await apiRequest(
                "/api/dashboard/reviews"
            );


        if (
            !data.success ||
            !Array.isArray(data.reviews)
        ) {

            dashboardReviewsContainer.innerHTML = `
                <div class="dashboard-review-empty">
                    Unable to load reviews.
                </div>
            `;

            return;
        }


        renderDashboardReviews(
            data.reviews
        );


    } catch (error) {

        console.error(
            "Dashboard review error:",
            error
        );


        dashboardReviewsContainer.innerHTML = `
            <div class="dashboard-review-empty">
                <i class="fa-solid fa-triangle-exclamation"></i>
                Unable to load patient reviews.
            </div>
        `;
    }
}


// =========================================================
// RENDER REVIEWS
// =========================================================

function renderDashboardReviews(
    reviews
) {

    if (!dashboardReviewsContainer) {
        return;
    }


    const pendingReviews =
        reviews.filter(
            function (review) {

                return review.status === "pending";

            }
        );


    if (pendingReviewsCount) {

        pendingReviewsCount.textContent =
            pendingReviews.length;

    }


    if (reviews.length === 0) {

        dashboardReviewsContainer.innerHTML = `
            <div class="dashboard-review-empty">

                <i class="fa-regular fa-comment"></i>

                <h3>
                    No Patient Reviews
                </h3>

                <p>
                    Patient reviews will appear here
                    after they are submitted.
                </p>

            </div>
        `;

        return;
    }


    dashboardReviewsContainer.innerHTML =
        reviews
            .map(
                function (review) {

                    return createDashboardReviewCard(
                        review
                    );

                }
            )
            .join("");
}


// =========================================================
// CREATE REVIEW CARD
// =========================================================

function createDashboardReviewCard(
    review
) {

    const rating =
        Math.max(
            1,
            Math.min(
                5,
                Number(review.rating) || 5
            )
        );


    const stars =
        "★".repeat(rating) +
        "☆".repeat(5 - rating);


    const status =
        String(
            review.status || "pending"
        ).toLowerCase();


    const date =
        review.created_at
            ? new Date(
                review.created_at
              ).toLocaleDateString(
                "en-IN",
                {
                    day: "2-digit",
                    month: "short",
                    year: "numeric"
                }
              )
            : "";


    let statusClass =
        "review-status-pending";


    let statusText =
        "Pending";


    if (status === "approved") {

        statusClass =
            "review-status-approved";

        statusText =
            "Approved";

    }


    if (status === "rejected") {

        statusClass =
            "review-status-rejected";

        statusText =
            "Rejected";

    }


    let actionButtons = "";


    if (status === "pending") {

        actionButtons = `

            <div class="dashboard-review-actions">

                <button
                    type="button"
                    class="approve-review-btn"
                    onclick="approveDashboardReview(
                        ${Number(review.id)}
                    )"
                >
                    <i class="fa-solid fa-check"></i>
                    Approve
                </button>


                <button
                    type="button"
                    class="reject-review-btn"
                    onclick="rejectDashboardReview(
                        ${Number(review.id)}
                    )"
                >
                    <i class="fa-solid fa-xmark"></i>
                    Reject
                </button>

            </div>

        `;

    }


    return `

        <article
            class="dashboard-review-card"
            data-review-id="${Number(review.id)}"
        >

            <div class="dashboard-review-main">

                <div class="dashboard-review-avatar">

                    ${escapeDashboardReviewHtml(
                        (
                            review.patient_name ||
                            "P"
                        )
                        .charAt(0)
                        .toUpperCase()
                    )}

                </div>


                <div class="dashboard-review-content">

                    <div class="dashboard-review-title-row">

                        <div>

                            <h3>
                                ${escapeDashboardReviewHtml(
                                    review.patient_name ||
                                    "Patient"
                                )}
                            </h3>

                            <p>
                                ${
                                    review.doctor_name
                                        ? "Dr. " +
                                          escapeDashboardReviewHtml(
                                              review.doctor_name
                                          )
                                        : "Doctor not available"
                                }
                            </p>

                        </div>


                        <span
                            class="dashboard-review-status ${statusClass}"
                        >
                            ${statusText}
                        </span>

                    </div>


                    <div class="dashboard-review-rating">

                        ${stars}

                    </div>


                    <p class="dashboard-review-text">

                        ${escapeDashboardReviewHtml(
                            review.review_text || ""
                        )}

                    </p>


                    <div class="dashboard-review-meta">

                        <span>
                            <i class="fa-regular fa-calendar"></i>
                            ${date}
                        </span>

                        <span>
                            <i class="fa-solid fa-id-card"></i>
                            Appointment #${Number(
                                review.appointment_id
                            )}
                        </span>

                    </div>


                    ${actionButtons}

                </div>

            </div>

        </article>

    `;
}


// =========================================================
// APPROVE REVIEW
// =========================================================

async function approveDashboardReview(
    reviewId
) {

    if (!reviewId) {
        return;
    }


    const confirmed =
        confirm(
            "Are you sure you want to approve this review?"
        );


    if (!confirmed) {
        return;
    }


    try {

        showLoading();


        const data =
            await apiRequest(
                `/api/dashboard/reviews/${reviewId}/approve`,
                {
                    method: "POST"
                }
            );


        if (data.success) {

            alert(
                "Review approved successfully."
            );

            await loadDashboardReviews();

        } else {

            alert(
                data.message ||
                "Unable to approve review."
            );
        }


    } catch (error) {

        console.error(
            "Approve review error:",
            error
        );

        alert(
            error.message ||
            "Unable to approve review."
        );

    } finally {

        hideLoading();

    }
}


// =========================================================
// REJECT REVIEW
// =========================================================

async function rejectDashboardReview(
    reviewId
) {

    if (!reviewId) {
        return;
    }


    const confirmed =
        confirm(
            "Are you sure you want to reject this review?"
        );


    if (!confirmed) {
        return;
    }


    try {

        showLoading();


        const data =
            await apiRequest(
                `/api/dashboard/reviews/${reviewId}/reject`,
                {
                    method: "POST"
                }
            );


        if (data.success) {

            alert(
                "Review rejected successfully."
            );

            await loadDashboardReviews();

        } else {

            alert(
                data.message ||
                "Unable to reject review."
            );
        }


    } catch (error) {

        console.error(
            "Reject review error:",
            error
        );

        alert(
            error.message ||
            "Unable to reject review."
        );

    } finally {

        hideLoading();

    }
}


// =========================================================
// ESCAPE HTML
// =========================================================

function escapeDashboardReviewHtml(
    value
) {

    const div =
        document.createElement(
            "div"
        );

    div.textContent =
        String(value);

    return div.innerHTML;
}


// =========================================================
// LOAD REVIEWS ON DASHBOARD
// =========================================================

document.addEventListener(
    "DOMContentLoaded",
    function () {

        loadDashboardReviews();

    }
);