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

        const allOption = document.createElement("option");
        allOption.value = "";
        allOption.textContent = "All Doctors";
        doctorSelect.appendChild(allOption);

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

        doctorSelect.value = currentValue || "";
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

        if (currentUser.role === "manager") {
            selectedDoctorTitle.textContent = "All Doctors";
            slotsContainer.innerHTML =
                `<p class="loading-text">
                    Select a specific doctor to view individual slot status.
                </p>`;
        } else {
            slotsContainer.innerHTML =
                `<p class="loading-text">
                    Please select a doctor.
                </p>`;
        }

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
        const fee = Number(patient.fee || 0);
        const feeHtml = Number(patient.is_free_followup)
            ? `<strong>₹0</strong><br><small class="free-followup-label">Free Follow-up</small>`
            : `<strong>₹${fee.toFixed(0)}</strong><br><small>New Visit</small>`;

        const consultStatus = patient.payment_status || "pending";
        const consultStatusHtml =
            `<span class="payment-btn ${consultStatus === "paid" ? "paid" : "pending"} active" style="cursor:default;display:inline-block;">
                ${consultStatus === "paid" ? "Paid" : "Pending"}
            </span>`;

        const labStatusHtml = patient.lab_payment_status
            ? `<span class="payment-btn ${patient.lab_payment_status === "paid" ? "paid" : "pending"} active" style="cursor:default;display:inline-block;">
                    ${patient.lab_payment_status === "paid" ? "Paid" : "Pending"} (₹${Number(patient.lab_total || 0).toFixed(0)})
               </span>`
            : `<span class="lab-not-billed">No Lab Bill Yet</span>`;

        const prescriptionText = patient.prescribed_tests
            ? patient.prescribed_tests
            : "<em>Not written</em>";
        const prescriptionHtml = currentUser.role === "doctor"
            ? `<div class="prescription-cell">
                    <div class="prescription-text">${prescriptionText}</div>
                    <button type="button" class="complete-btn" style="margin-top:4px;font-size:12px;padding:4px 8px;"
                        onclick='writePrescription(${patient.id}, ${JSON.stringify(patient.prescribed_tests || "")})'>
                        ${patient.prescribed_tests ? "Edit" : "Write"} Prescription
                    </button>
               </div>`
            : `<div class="prescription-text">${prescriptionText}</div>`;

        const row = document.createElement("tr");
        row.innerHTML = `
            <td>${index + 1}</td>
            <td><strong class="patient-token">${patient.token_number || "-"}</strong></td>
            <td><strong>${patient.patient_name || "-"}</strong></td>
            <td>${patient.patient_age || "-"}</td>
            <td>${patient.patient_gender || "-"}</td>
            <td>${patient.time_slot || "-"}</td>
            <td>${patient.reason || "-"}</td>
            <td>${feeHtml}</td>
            <td>${consultStatusHtml}</td>
            <td>${prescriptionHtml}</td>
            <td>${labStatusHtml}</td>
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
    });

    updateTodaysCollection(data.patients);
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

// Patient-side follow-up selection has been removed. Cashier decides Free Follow-up.

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




// Queue and patient-side follow-up controls have been intentionally removed from the dashboard.

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
        if (currentUser.role === "manager" && typeof loadCollectionDashboard === "function") {
            await loadCollectionDashboard();
        }
        if (currentUser.role === "manager" && typeof loadLabCollectionDashboard === "function") {
            await loadLabCollectionDashboard();
        }
    }
);


doctorSelect.addEventListener(
    "change",
    async () => {

        await loadSlots();

        await loadPatients();
        if (currentUser.role === "manager" && typeof loadCollectionDashboard === "function") {
            await loadCollectionDashboard();
        }
        if (currentUser.role === "manager" && typeof loadLabCollectionDashboard === "function") {
            await loadLabCollectionDashboard();
        }
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