// Bharat Care Hospital - Full Frontend Application State & Logic

document.addEventListener('DOMContentLoaded', () => {
    // --- Application State ---
    let state = {
        user: JSON.parse(localStorage.getItem('carepulse_user')) || null,
        token: localStorage.getItem('carepulse_token') || null,
        doctors: [],
        activeSpecialty: 'All',
        selectedDoctorForBooking: null,
        waPhone: '+919472396918'
    };

    // --- DOM Elements ---
    const doctorsContainer = document.getElementById('doctorsContainer');
    const searchInput = document.getElementById('searchInput');
    const specialtySelect = document.getElementById('specialtySelect');
    const searchBtn = document.getElementById('searchBtn');
    const activeFilterLabel = document.getElementById('activeFilterLabel');

    // Auth Elements
    const authNavButtons = document.getElementById('authNavButtons');
    const userProfileNav = document.getElementById('userProfileNav');
    const loginBtn = document.getElementById('loginBtn');
    const signupBtn = document.getElementById('signupBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const authModal = document.getElementById('authModal');
    const closeAuthModal = document.getElementById('closeAuthModal');
    const loginTabBtn = document.getElementById('loginTabBtn');
    const signupTabBtn = document.getElementById('signupTabBtn');
    const loginForm = document.getElementById('loginForm');
    const signupForm = document.getElementById('signupForm');

    // Booking Modal Elements
    const bookingModal = document.getElementById('bookingModal');
    const closeBookingModal = document.getElementById('closeBookingModal');
    const bookingForm = document.getElementById('bookingForm');
    const bookingDoctorId = document.getElementById('bookingDoctorId');
    const modalDocName = document.getElementById('modalDocName');
    const modalDocSpec = document.getElementById('modalDocSpec');
    const modalDocFee = document.getElementById('modalDocFee');
    const modalDocPhoto = document.getElementById('modalDocPhoto');
    const apptDateInput = document.getElementById('apptDate');
    const apptSlotSelect = document.getElementById('apptSlot');

    // Dashboard Elements
    const dashboardSection = document.getElementById('dashboardSection');
    const dashboardToggleBtn = document.getElementById('dashboardToggleBtn');
    const closeDashboardBtn = document.getElementById('closeDashboardBtn');
    const dashboardApptsContainer = document.getElementById('dashboardApptsContainer');

    // WhatsApp Simulator Elements
    const waFabBtn = document.getElementById('waFabBtn');
    const waChatWindow = document.getElementById('waChatWindow');
    const waCloseBtn = document.getElementById('waCloseBtn');
    const waChatMessages = document.getElementById('waChatMessages');
    const waInput = document.getElementById('waInput');
    const waSendBtn = document.getElementById('waSendBtn');
    const triggerWaSimBtn = document.getElementById('triggerWaSimBtn');

    // Toast Container
    const toastContainer = document.getElementById('toastContainer');

    // --- Initialization ---
    initApp();

    function initApp() {
        // Booking allowed: Today, Tomorrow and Day After Tomorrow
        if (apptDateInput) {
            const today = getLocalDateString(new Date());

            const dayAfterTomorrow = new Date();
            dayAfterTomorrow.setDate(
                dayAfterTomorrow.getDate() + 2
            );

            apptDateInput.min = today;
            apptDateInput.max = getLocalDateString(
                dayAfterTomorrow
            );

            apptDateInput.value = today;
        }

        updateAuthUI();
        loadDoctors();
        setupEventListeners();
    }


    function getLocalDateString(date) {
        const year = date.getFullYear();

        const month = String(
            date.getMonth() + 1
        ).padStart(2, '0');

        const day = String(
            date.getDate()
        ).padStart(2, '0');

        return `${year}-${month}-${day}`;
    }


    function resetSlotOptions(
        message = 'Select doctor and date first'
    ) {
        if (!apptSlotSelect) return;

        apptSlotSelect.innerHTML = '';

        const option = document.createElement('option');

        option.value = '';
        option.textContent = message;
        option.disabled = true;
        option.selected = true;

        apptSlotSelect.appendChild(option);

        apptSlotSelect.disabled = true;
    }


    async function loadAvailableSlots() {

        if (!apptSlotSelect) return;

        const doctorId = bookingDoctorId
            ? bookingDoctorId.value
            : '';

        const appointmentDate = apptDateInput
            ? apptDateInput.value
            : '';

        if (!doctorId || !appointmentDate) {
            resetSlotOptions(
                'Select doctor and date first'
            );
            return;
        }


        resetSlotOptions(
            'Loading available slots...'
        );


        try {

            const url =
                `/api/appointments/slots?doctor_id=${encodeURIComponent(
                    doctorId
                )}&appointment_date=${encodeURIComponent(
                    appointmentDate
                )}`;


            const res = await fetch(url);

            const data = await res.json();


            if (!res.ok || !data.success) {

                resetSlotOptions(
                    data.message ||
                    'Unable to load slots'
                );

                showToast(
                    data.message ||
                    'Unable to load appointment slots.',
                    'error'
                );

                return;
            }


            apptSlotSelect.innerHTML = '';


            const placeholder =
                document.createElement('option');

            placeholder.value = '';

            placeholder.textContent =
                'Select an available time slot';

            placeholder.disabled = true;
            placeholder.selected = true;

            apptSlotSelect.appendChild(
                placeholder
            );


            let availableCount = 0;


            data.slots.forEach(slot => {

                const option =
                    document.createElement('option');

                option.value = slot.slot;


                if (slot.is_past) {

                    option.textContent =
                        `${slot.slot} — Started/Past`;

                    option.disabled = true;

                }
                else if (slot.is_full) {

                    option.textContent =
                        `${slot.slot} — FULL (15/15)`;

                    option.disabled = true;

                }
                else if (slot.is_locked) {

                    option.textContent =
                        `${slot.slot} — 🔒 Locked (opens once earlier slot is full)`;

                    option.disabled = true;

                }
                else {

                    option.textContent =
                        `${slot.slot} — ${slot.seats_left} seat(s) left`;

                    availableCount += 1;
                }


                apptSlotSelect.appendChild(
                    option
                );

            });


            apptSlotSelect.disabled =
                availableCount === 0;


            if (availableCount === 0) {

                const noSlot =
                    document.createElement('option');

                noSlot.value = '';

                noSlot.textContent =
                    'No slots available for this date';

                noSlot.disabled = true;

                apptSlotSelect.appendChild(
                    noSlot
                );
            }


        }
        catch (err) {

            console.error(
                'Error loading slots:',
                err
            );

            resetSlotOptions(
                'Network error while loading slots'
            );
        }
    }



    // --- Toast Notification Helper ---
    function showToast(message, type = 'success') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        const icon = type === 'success' ? 'fa-circle-check' : 'fa-circle-exclamation';
        toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;
        toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.remove();
        }, 4000);
    }

    // --- Auth UI Handling ---
    function updateAuthUI() {
        if (state.user && state.token) {
            authNavButtons.classList.add('hidden');
            userProfileNav.classList.remove('hidden');
        } else {
            authNavButtons.classList.remove('hidden');
            userProfileNav.classList.add('hidden');
        }
    }

    // --- Load Doctors from API ---
    async function loadDoctors(specialty = 'All', search = '') {
        doctorsContainer.innerHTML = `<div class="loading-spinner"><i class="fa-solid fa-spinner fa-spin"></i> Loading Doctor Catalog...</div>`;
        try {
            let url = `/api/doctors?specialty=${encodeURIComponent(specialty)}&search=${encodeURIComponent(search)}`;
            const res = await fetch(url);
            const data = await res.json();

            if (data.success) {
                state.doctors = data.doctors;
                renderDoctors(data.doctors);
            } else {
                doctorsContainer.innerHTML = `<p class="error-msg">Failed to load doctors.</p>`;
            }
        } catch (err) {
            console.error('Error fetching doctors:', err);
            doctorsContainer.innerHTML = `<p class="error-msg">Network error while fetching doctors.</p>`;
        }
    }

    // --- Render Doctor Cards ---
    function renderDoctors(doctors) {
        if (!doctors || doctors.length === 0) {
            doctorsContainer.innerHTML = `
                <div class="no-doctors glass-panel" style="grid-column: 1/-1; padding: 40px; text-align: center;">
                    <i class="fa-solid fa-user-doctor" style="font-size: 3rem; color: var(--text-muted); margin-bottom: 16px;"></i>
                    <h3>No Doctors Found</h3>
                    <p>Try searching for a different name or selecting another department.</p>
                </div>
            `;
            return;
        }

        doctorsContainer.innerHTML = doctors.map(doc => `
            <div class="doctor-card" data-id="${doc.id}">
                <div class="doc-header">
                    <img src="${doc.photo_url}" alt="${doc.name}" class="doc-avatar">
                    <div class="doc-info">
                        <span class="doc-badge">${doc.specialty}</span>
                        <h3 class="doc-name">${doc.name}</h3>
                        <p class="doc-qual">${doc.qualification}</p>
                        <div class="doc-rating">
                            <i class="fa-solid fa-star"></i> ${doc.rating} Rating (${doc.experience} Yrs Exp)
                        </div>
                    </div>
                </div>
                
                <div class="doc-body">
                    <div class="doc-meta-item">
                        <i class="fa-solid fa-clock"></i>
                        <span>Timing: <strong>${doc.timing}</strong></span>
                    </div>
                    <div class="doc-meta-item">
                        <i class="fa-solid fa-indian-rupee-sign"></i>
                        <span>Consultation Fee: <strong>₹${doc.fee}</strong></span>
                    </div>
                    <p class="doc-about">${doc.about}</p>
                </div>

                <div class="doc-footer">
                    <button class="btn btn-primary btn-block open-book-modal" data-id="${doc.id}">
                        <i class="fa-solid fa-calendar-check"></i> Book Appointment (Web)
                    </button>
                    <button class="btn btn-whatsapp btn-block open-wa-book" data-id="${doc.id}">
                        <i class="fa-brands fa-whatsapp"></i> Book via WhatsApp
                    </button>
                </div>
            </div>
        `).join('');

        // Attach Event Listeners to rendered doctor buttons
        document.querySelectorAll('.open-book-modal').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const docId = e.currentTarget.getAttribute('data-id');
                openBookingModal(docId);
            });
        });

        document.querySelectorAll('.open-wa-book').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const docId = e.currentTarget.getAttribute('data-id');
                triggerWhatsAppBookingForDoctor(docId);
            });
        });
    }

    // --- Open Booking Modal ---
    function openBookingModal(doctorId) {
        const doctor = state.doctors.find(d => d.id == doctorId);
        if (!doctor) return;

        state.selectedDoctorForBooking = doctor;
        bookingDoctorId.value = doctor.id;
        modalDocName.textContent = doctor.name;
        modalDocSpec.textContent = doctor.specialty;
        modalDocFee.textContent = `Consultation Fee: ₹${doctor.fee}`;
        modalDocPhoto.src = doctor.photo_url;

        // Prefill patient info if logged in
        if (state.user) {
            document.getElementById('patientName').value = state.user.name || '';
            document.getElementById('patientPhone').value = state.user.phone || '';
            document.getElementById('patientEmail').value = state.user.email || '';
        }

        bookingModal.classList.remove('hidden');
        loadAvailableSlots();
    }

    // --- WhatsApp Booking Trigger for Specific Doctor ---
    function triggerWhatsAppBookingForDoctor(doctorId) {
        const doctor = state.doctors.find(d => d.id == doctorId);
        if (!doctor) return;

        // Open Floating Chat Window
        waChatWindow.classList.remove('hidden');

        // Send simulated WhatsApp greeting message tailored to doctor
        const initialMsg = `Hi, I want to book an appointment with ${doctor.name} (${doctor.specialty}).`;
        sendWaMessage(initialMsg);
        showToast(`WhatsApp session initiated for ${doctor.name}!`, 'success');
    }

    // --- Handle Web Booking Submission ---
    bookingForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const confirmBtn = document.getElementById('confirmBookingBtn');
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Confirming...`;

        if (!document.getElementById('apptSlot').value) {
            showToast(
                'Please select an available appointment slot.',
                'error'
            );

            confirmBtn.disabled = false;

            confirmBtn.innerHTML =
                `<i class="fa-solid fa-check-circle"></i> Confirm Appointment`;

            return;
        }

        const payload = {
            doctor_id: parseInt(bookingDoctorId.value),
            patient_name: document.getElementById('patientName').value,
            patient_phone: document.getElementById('patientPhone').value,
            patient_email: document.getElementById('patientEmail').value,
            patient_age: parseInt(document.getElementById('patientAge').value) || 28,
            patient_gender: document.getElementById('patientGender').value,
            appointment_date: document.getElementById('apptDate').value,
            time_slot: document.getElementById('apptSlot').value,
            reason: document.getElementById('apptReason').value || 'General Consultation',
            patient_id: state.user ? state.user.id : null,
            booking_source: 'web'
        };

        try {
            const res = await fetch('/api/appointments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();

            if (data.success) {
                showToast(`Appointment Confirmed! Ref ID: #APPT-${data.appointment_id}`, 'success');
                bookingModal.classList.add('hidden');
                bookingForm.reset();

                // Open Dashboard to show appointment
                openDashboard();
            } else {
                showToast(data.message || 'Failed to book appointment.', 'error');
                loadAvailableSlots();
            }
        } catch (err) {
            console.error('Error booking appointment:', err);
            showToast('Network error while booking appointment.', 'error');
        } finally {
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = `<i class="fa-solid fa-check-circle"></i> Confirm Appointment`;
        }
    });

    // --- Patient Dashboard ---
    async function openDashboard() {
        dashboardSection.classList.remove('hidden');
        dashboardSection.scrollIntoView({ behavior: 'smooth' });

        const phone = state.user ? state.user.phone : document.getElementById('patientPhone').value;
        const patient_id = state.user ? state.user.id : '';

        dashboardApptsContainer.innerHTML = `<div class="loading-spinner"><i class="fa-solid fa-spinner fa-spin"></i> Fetching your appointments...</div>`;

        try {
            const res = await fetch(`/api/appointments/my?phone=${encodeURIComponent(phone || '')}&patient_id=${patient_id}`);
            const data = await res.json();

            if (data.success && data.appointments.length > 0) {
                renderAppointments(data.appointments);
            } else {
                dashboardApptsContainer.innerHTML = `
                    <div class="glass-panel" style="grid-column: 1/-1; padding: 30px; text-align: center;">
                        <i class="fa-solid fa-calendar-xmark" style="font-size: 2.5rem; color: var(--text-muted); margin-bottom: 12px;"></i>
                        <h4>No Booked Appointments Found</h4>
                        <p>Book an appointment above via Web or WhatsApp to view it here.</p>
                    </div>
                `;
            }
        } catch (err) {
            console.error('Dashboard fetch error:', err);
            dashboardApptsContainer.innerHTML = `<p class="error-msg">Error loading appointments.</p>`;
        }
    }

    function renderAppointments(appts) {
        dashboardApptsContainer.innerHTML = appts.map(a => `
            <div class="appt-card glass-panel">
                <div class="flex-between">
                    <span class="appt-status-badge ${a.status}">${a.status}</span>
                    <span class="badge" style="background:#e2e8f0; color:#334155; font-size:0.75rem;">Source: ${a.booking_source.toUpperCase()}</span>
                </div>
                <div>
                    <h4 style="font-size:1.1rem; margin-bottom:4px;">👨‍⚕️ ${a.doctor_name}</h4>
                    <span style="font-size:0.85rem; color:var(--primary); font-weight:600;">${a.doctor_specialty}</span>
                </div>
                <div style="font-size:0.9rem; color:var(--text-muted);">
                    <div><i class="fa-solid fa-calendar-day"></i> Date: <strong>${a.appointment_date}</strong></div>
                    <div><i class="fa-solid fa-clock"></i> Time: <strong>${a.time_slot}</strong></div>
                    <div><i class="fa-solid fa-user"></i> Patient: <strong>${a.patient_name} (${a.patient_phone})</strong></div>
                    <div><i class="fa-solid fa-indian-rupee-sign"></i> Consultation Fee: <strong>₹${a.doctor_fee}</strong></div>
                </div>
                <div style="margin-top:8px; display:flex; gap:10px;">
                    <button class="btn btn-outline btn-block print-slip-btn" data-id="${a.id}">
                        <i class="fa-solid fa-print"></i> Print Slip
                    </button>
                </div>
            </div>
        `).join('');

        document.querySelectorAll('.print-slip-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.currentTarget.getAttribute('data-id');
                const appt = appts.find(item => item.id == id);
                if (appt) {
                    alert(`🏥 BHARAT CARE NURSING HOME APPOINTMENT SLIP\n------------------------------------\nBooking ID: #APPT-${appt.id}\nDoctor: ${appt.doctor_name} (${appt.doctor_specialty})\nPatient: ${appt.patient_name}\nDate: ${appt.appointment_date} at ${appt.time_slot}\nFee: ₹${appt.doctor_fee}\nStatus: ${appt.status.toUpperCase()}\nSource: ${appt.booking_source.toUpperCase()}\nAddress: Purabpali in premises of Bharat Care Centre, Dharamganj, Kishanganj, Bihar (855107)\nEmergency: +91 9472396918\n\nPlease present this slip at hospital registration 10 min prior to time.`);
                }
            });
        });
    }

    // --- Interactive WhatsApp Chat Bot Logic ---
    async function sendWaMessage(text) {
        if (!text || text.trim() === '') return;

        // Append User Message to Chat UI
        appendWaBubble(text, 'user');
        waInput.value = '';

        try {
            const res = await fetch('/api/whatsapp/webhook', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: state.waPhone, message: text })
            });
            const data = await res.json();

            if (data.success) {
                setTimeout(() => {
                    appendWaBubble(data.reply, 'bot');
                    // If appointment confirmed, trigger dashboard refresh
                    if (data.appointment_id) {
                        showToast(`WhatsApp Appointment #${data.appointment_id} Confirmed!`, 'success');
                        openDashboard();
                    }
                }, 600);
            }
        } catch (err) {
            console.error('WhatsApp Bot Error:', err);
            appendWaBubble('⚠️ Connection error to WhatsApp Bot server.', 'bot');
        }
    }

    function appendWaBubble(messageText, sender = 'bot') {
        const msgDiv = document.createElement('div');
        msgDiv.className = `wa-msg ${sender}`;

        // Format markdown bold & linebreaks
        let formattedText = messageText
            .replace(/\*(.*?)\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br>');

        msgDiv.innerHTML = `
            <div class="wa-bubble">${formattedText}</div>
            <span class="wa-time">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        `;

        waChatMessages.appendChild(msgDiv);
        waChatMessages.scrollTop = waChatMessages.scrollHeight;
    }

    // --- Setup General Event Listeners ---
    function setupEventListeners() {
        if (apptDateInput) {

            apptDateInput.addEventListener(
                'change',
                () => {
                    loadAvailableSlots();
                }
            );

        }
        // Specialty Filter Cards
        document.querySelectorAll('.specialty-card').forEach(card => {
            card.addEventListener('click', (e) => {
                document.querySelectorAll('.specialty-card').forEach(c => c.classList.remove('active'));
                card.classList.add('active');

                const spec = card.getAttribute('data-spec');
                state.activeSpecialty = spec;
                specialtySelect.value = spec;
                activeFilterLabel.textContent = `Showing: ${spec} Doctors`;

                loadDoctors(spec, searchInput.value);
            });
        });

        // Search bar
        searchBtn.addEventListener('click', () => {
            const spec = specialtySelect.value;
            const term = searchInput.value;
            activeFilterLabel.textContent = `Search: "${term || spec}"`;
            loadDoctors(spec, term);
        });

        specialtySelect.addEventListener('change', (e) => {
            const spec = e.target.value;
            loadDoctors(spec, searchInput.value);
        });

        // Modals Toggle
        closeBookingModal.addEventListener('click', () => bookingModal.classList.add('hidden'));

        loginBtn.addEventListener('click', () => {
            authModal.classList.remove('hidden');
            loginForm.classList.remove('hidden');
            signupForm.classList.add('hidden');
            loginTabBtn.classList.add('active');
            signupTabBtn.classList.remove('active');
        });

        signupBtn.addEventListener('click', () => {
            authModal.classList.remove('hidden');
            loginForm.classList.add('hidden');
            signupForm.classList.remove('hidden');
            loginTabBtn.classList.remove('active');
            signupTabBtn.classList.add('active');
        });

        closeAuthModal.addEventListener('click', () => authModal.classList.add('hidden'));

        loginTabBtn.addEventListener('click', () => {
            loginForm.classList.remove('hidden');
            signupForm.classList.add('hidden');
            loginTabBtn.classList.add('active');
            signupTabBtn.classList.remove('active');
        });

        signupTabBtn.addEventListener('click', () => {
            loginForm.classList.add('hidden');
            signupForm.classList.remove('hidden');
            loginTabBtn.classList.remove('active');
            signupTabBtn.classList.add('active');
        });


        // Patient vs Hospital Staff login
        const patientLoginMode = document.getElementById('patientLoginMode');
        const staffLoginMode = document.getElementById('staffLoginMode');
        const staffRoleGroup = document.getElementById('staffRoleGroup');
        const staffLoginRole = document.getElementById('staffLoginRole');
        const loginIdentifier = document.getElementById('loginIdentifier');
        const loginTitle = document.getElementById('loginTitle');
        const loginSubtitle = document.getElementById('loginSubtitle');
        const loginSubmitBtn = document.getElementById('loginSubmitBtn');
        let loginMode = 'patient';

        function setLoginMode(mode) {
            loginMode = mode;
            const staff = mode === 'staff';
            staffRoleGroup.classList.toggle('hidden', !staff);
            patientLoginMode.classList.toggle('btn-primary', !staff);
            patientLoginMode.classList.toggle('btn-outline', staff);
            staffLoginMode.classList.toggle('btn-primary', staff);
            staffLoginMode.classList.toggle('btn-outline', !staff);
            loginTitle.textContent = staff ? 'Hospital Staff Login' : 'Patient Login';
            loginSubtitle.textContent = staff ? 'Authorized hospital staff: select your role and use your hospital email.' : 'Login with your registered email or mobile number.';
            loginIdentifier.placeholder = staff ? 'Enter hospital email' : 'Enter email or mobile number';
            loginIdentifier.type = staff ? 'email' : 'text';
            loginSubmitBtn.textContent = staff ? 'Login to Hospital Dashboard' : 'Login as Patient';
        }
        patientLoginMode.addEventListener('click', () => setLoginMode('patient'));
        staffLoginMode.addEventListener('click', () => setLoginMode('staff'));
        setLoginMode('patient');

        // Login Handler
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const identifier = loginIdentifier.value.trim();
            const password = document.getElementById('loginPassword').value;
            const requestedRole = staffLoginRole.value;
            try {
                const res = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ identifier, password, login_type: loginMode, requested_role: loginMode === 'staff' ? requestedRole : 'patient' })
                });
                const data = await res.json();
                if (data.success) {
                    state.user = data.user;
                    state.token = data.token;
                    localStorage.setItem('carepulse_user', JSON.stringify(data.user));
                    localStorage.setItem('carepulse_token', data.token);
                    if (['doctor', 'manager', 'cashier', 'lab_cashier'].includes(data.user.role)) {
                        window.location.href = '/dashboard';
                        return;
                    }
                    updateAuthUI();
                    authModal.classList.add('hidden');
                    showToast(`Welcome back, ${data.user.name}!`, 'success');
                } else {
                    showToast(data.message || 'Login failed.', 'error');
                }
            } catch (error) {
                console.error('Login error:', error);
                showToast('Login request failed. Please try again.', 'error');
            }
        });

        // Signup Handler


        signupForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('signupName').value;
            const email = document.getElementById('signupEmail').value;
            const phone = document.getElementById('signupPhone').value;
            const password = document.getElementById('signupPassword').value;

            try {
                const res = await fetch('/api/auth/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, email, phone, password })
                });
                const data = await res.json();

                if (data.success) {
                    state.user = data.user;
                    state.token = data.token;
                    localStorage.setItem('carepulse_user', JSON.stringify(data.user));
                    localStorage.setItem('carepulse_token', data.token);

                    updateAuthUI();
                    authModal.classList.add('hidden');
                    showToast(`Account created successfully! Welcome ${data.user.name}.`, 'success');
                } else {
                    showToast(data.message || 'Signup failed.', 'error');
                }
            } catch (err) {
                showToast('Signup request failed.', 'error');
            }
        });

        // Logout Handler
        logoutBtn.addEventListener('click', () => {
            state.user = null;
            state.token = null;
            localStorage.removeItem('carepulse_user');
            localStorage.removeItem('carepulse_token');
            updateAuthUI();
            dashboardSection.classList.add('hidden');
            showToast('Logged out successfully.', 'success');
        });

        // Dashboard Toggle
        dashboardToggleBtn.addEventListener('click', openDashboard);
        closeDashboardBtn.addEventListener('click', () => dashboardSection.classList.add('hidden'));

        // WhatsApp Chat Simulator Actions
        waFabBtn.addEventListener('click', () => {
            waChatWindow.classList.toggle('hidden');
        });

        waCloseBtn.addEventListener('click', () => {
            waChatWindow.classList.add('hidden');
        });

        if (triggerWaSimBtn) {
            triggerWaSimBtn.addEventListener('click', () => {
                waChatWindow.classList.remove('hidden');
                sendWaMessage('Hi');
            });
        }

        waSendBtn.addEventListener('click', () => sendWaMessage(waInput.value));
        waInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendWaMessage(waInput.value);
        });

        // Quick Chip Click Handlers
        document.querySelectorAll('.chip-btn').forEach(chip => {
            chip.addEventListener('click', (e) => {
                const msg = e.currentTarget.getAttribute('data-msg');
                sendWaMessage(msg);
            });
        });
    }
});



/* =====================================================
   HOSPITAL PHOTO GALLERY AUTO SLIDER
===================================================== */

document.addEventListener("DOMContentLoaded", function () {

    const gallerySlides =
        document.querySelectorAll(".gallery-slide");

    const galleryPrev =
        document.getElementById("galleryPrev");

    const galleryNext =
        document.getElementById("galleryNext");

    const galleryIndicators =
        document.getElementById("galleryIndicators");

    const galleryContainer =
        document.querySelector(".gallery-container");


    // Gallery nahi hai to stop
    if (gallerySlides.length === 0) {
        return;
    }


    let currentGalleryIndex = 0;
    let galleryAutoSlide = null;


    /* ================================
       SHOW SLIDE
    ================================= */

    function showGallerySlide(index) {

        if (index >= gallerySlides.length) {
            index = 0;
        }

        if (index < 0) {
            index = gallerySlides.length - 1;
        }

        currentGalleryIndex = index;


        gallerySlides.forEach(function (slide, slideIndex) {

            slide.classList.remove("active");

            if (slideIndex === currentGalleryIndex) {
                slide.classList.add("active");
            }

        });


        // Update dots
        document
            .querySelectorAll(".gallery-dot")
            .forEach(function (dot, dotIndex) {

                dot.classList.remove("active");

                if (dotIndex === currentGalleryIndex) {
                    dot.classList.add("active");
                }

            });

    }


    /* ================================
       NEXT
    ================================= */

    function nextGallerySlide() {

        showGallerySlide(
            currentGalleryIndex + 1
        );

    }


    /* ================================
       PREVIOUS
    ================================= */

    function previousGallerySlide() {

        showGallerySlide(
            currentGalleryIndex - 1
        );

    }


    /* ================================
       CREATE DOTS
    ================================= */

    (galleryIndicators)

    gallerySlides.forEach((slide, index) => {

        const dot =
            document.createElement("button");

        dot.classList.add("gallery-dot");

        if (index === 0) {
            dot.classList.add("active");
        }

        dot.setAttribute(
            "aria-label",
            `Go to image ${index + 1}`
        );

        dot.addEventListener("click", function () {

            showGallerySlide(index);

            resetGalleryAutoSlide();

        });

        galleryIndicators.appendChild(dot);

    });


    /* ================================
       BUTTON EVENTS
    ================================= */

    if (galleryNext) {

        galleryNext.addEventListener(
            "click",
            function () {

                nextGallerySlide();

                resetGalleryAutoSlide();

            }
        );

    }


    if (galleryPrev) {

        galleryPrev.addEventListener(
            "click",
            function () {

                previousGallerySlide();

                resetGalleryAutoSlide();

            }
        );

    }


    /* ================================
       AUTO SLIDE
    ================================= */

    function startGalleryAutoSlide() {

        // Duplicate interval avoid karega
        clearInterval(galleryAutoSlide);

        galleryAutoSlide =
            setInterval(
                function () {

                    nextGallerySlide();

                },
                5000
            );

    }


    /* ================================
       RESET AUTO SLIDE
    ================================= */

    function resetGalleryAutoSlide() {

        clearInterval(galleryAutoSlide);

        startGalleryAutoSlide();

    }


    /* ================================
       PAUSE ON HOVER
    ================================= */

    if (galleryContainer) {

        galleryContainer.addEventListener(
            "mouseenter",
            function () {

                clearInterval(galleryAutoSlide);

            }
        );


        galleryContainer.addEventListener(
            "mouseleave",
            function () {

                startGalleryAutoSlide();

            }
        );

    }


    /* ================================
       START GALLERY
    ================================= */

    showGallerySlide(0);

    startGalleryAutoSlide();

});



// =========================================================
// PATIENT REVIEWS
// =========================================================

let selectedReviewRating = 0;


// ---------------------------------------------------------
// OPEN REVIEW MODAL
// ---------------------------------------------------------

function openReviewModal() {

    const modal = document.getElementById("reviewModal");

    if (!modal) {
        return;
    }

    modal.style.display = "flex";

    document.body.style.overflow = "hidden";
}


// ---------------------------------------------------------
// CLOSE REVIEW MODAL
// ---------------------------------------------------------

function closeReviewModal() {

    const modal = document.getElementById("reviewModal");

    if (!modal) {
        return;
    }

    modal.style.display = "none";

    document.body.style.overflow = "";

    resetReviewForm();
}


// ---------------------------------------------------------
// RESET REVIEW FORM
// ---------------------------------------------------------

function resetReviewForm() {

    const form = document.getElementById(
        "patientReviewForm"
    );

    if (form) {
        form.reset();
    }

    selectedReviewRating = 0;

    const ratingInput =
        document.getElementById("reviewRating");

    if (ratingInput) {
        ratingInput.value = "0";
    }

    document
        .querySelectorAll(".star-rating button")
        .forEach(function (button) {

            button.classList.remove("selected");

        });

    const message =
        document.getElementById("reviewFormMessage");

    if (message) {
        message.textContent = "";
        message.className = "review-form-message";
    }
}


// ---------------------------------------------------------
// STAR RATING
// ---------------------------------------------------------

document.addEventListener(
    "click",
    function (event) {

        const button =
            event.target.closest(
                ".star-rating button"
            );

        if (!button) {
            return;
        }

        const rating =
            Number(
                button.dataset.rating
            );

        if (!rating) {
            return;
        }

        selectedReviewRating = rating;

        const ratingInput =
            document.getElementById(
                "reviewRating"
            );

        if (ratingInput) {
            ratingInput.value = rating;
        }

        document
            .querySelectorAll(
                ".star-rating button"
            )
            .forEach(function (star) {

                const starRating =
                    Number(
                        star.dataset.rating
                    );

                if (starRating <= rating) {

                    star.classList.add(
                        "selected"
                    );

                } else {

                    star.classList.remove(
                        "selected"
                    );

                }

            });

    }
);


// ---------------------------------------------------------
// LOAD APPROVED REVIEWS
// ---------------------------------------------------------

async function loadPatientReviews() {

    const container =
        document.getElementById(
            "reviewsContainer"
        );

    if (!container) {
        return;
    }

    try {

        const response =
            await fetch("/api/reviews");

        const data =
            await response.json();

        if (
            !data.success ||
            !Array.isArray(data.reviews)
        ) {

            container.innerHTML = `
                <div class="review-empty">
                    No patient reviews available yet.
                </div>
            `;

            return;
        }


        if (data.reviews.length === 0) {

            container.innerHTML = `
                <div class="review-empty">
                    <i class="fa-regular fa-comment"></i>
                    <h4>No reviews yet</h4>
                    <p>
                        Be the first patient to share your experience.
                    </p>
                </div>
            `;

            return;
        }


        container.innerHTML =
            data.reviews
                .map(function (review) {

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

                    return `
                        <article class="patient-review-card">

                            <div class="patient-review-top">

                                <div class="patient-avatar">
                                    ${escapeReviewHtml(
                        (review.patient_name || "P")
                            .charAt(0)
                            .toUpperCase()
                    )}
                                </div>

                                <div class="patient-review-info">

                                    <h4>
                                        ${escapeReviewHtml(
                        review.patient_name ||
                        "Patient"
                    )}
                                    </h4>

                                    <span>
                                        Verified Patient
                                    </span>

                                </div>

                            </div>


                            <div class="patient-review-stars">
                                ${stars}
                            </div>


                            <p class="patient-review-text">
                                ${escapeReviewHtml(
                        review.review_text || ""
                    )}
                            </p>


                            <div class="patient-review-footer">

                                <span>
                                    ${review.doctor_name
                            ? "Dr. " +
                            escapeReviewHtml(
                                review.doctor_name
                            )
                            : "Bharat Care Nursing Home"
                        }
                                </span>

                                <span>
                                    ${date}
                                </span>

                            </div>

                        </article>
                    `;

                })
                .join("");

    } catch (error) {

        console.error(
            "Review loading error:",
            error
        );

        container.innerHTML = `
            <div class="review-empty">
                Unable to load reviews right now.
            </div>
        `;
    }
}


// ---------------------------------------------------------
// ESCAPE REVIEW HTML
// ---------------------------------------------------------

function escapeReviewHtml(value) {

    const div =
        document.createElement("div");

    div.textContent =
        String(value);

    return div.innerHTML;
}


// ---------------------------------------------------------
// SUBMIT REVIEW
// ---------------------------------------------------------

document.addEventListener(
    "submit",
    async function (event) {

        const form =
            event.target.closest(
                "#patientReviewForm"
            );

        if (!form) {
            return;
        }

        event.preventDefault();




        let appointmentId =
            document
                .getElementById("reviewAppointmentId")
                .value
                .trim();


        // # हटाएँ
        appointmentId =
            appointmentId.replace(/^#/, "").trim();


        // केवल number स्वीकार करें
        if (!/^\d+$/.test(appointmentId)) {

            showToast(
                "Please enter a valid Appointment ID, for example #12345 or 12345.",
                "error"
            );

            return;
        }


        // Database के लिए number बनाएं
        appointmentId =
            Number(appointmentId);


        const reviewText =
            document.getElementById(
                "reviewText"
            ).value.trim();


        const message =
            document.getElementById(
                "reviewFormMessage"
            );


        if (!appointmentId) {

            showReviewMessage(
                message,
                "Please enter your appointment ID.",
                "error"
            );

            return;
        }


        if (rating < 1 || rating > 5) {

            showReviewMessage(
                message,
                "Please select your rating.",
                "error"
            );

            return;
        }


        if (!reviewText) {

            showReviewMessage(
                message,
                "Please write your experience.",
                "error"
            );

            return;
        }


        const submitButton =
            form.querySelector(
                ".review-submit-btn"
            );


        submitButton.disabled = true;

        submitButton.innerHTML =
            `
                <i class="fa-solid fa-spinner fa-spin"></i>
                Submitting...
            `;


        try {

            const response =
                await fetch(
                    "/api/reviews",
                    {
                        method: "POST",

                        headers: {
                            "Content-Type":
                                "application/json"
                        },

                        body: JSON.stringify({
                            appointment_id:
                                Number(
                                    appointmentId
                                ),

                            rating:
                                rating,

                            review_text:
                                reviewText
                        })
                    }
                );


            const data =
                await response.json();


            if (!response.ok || !data.success) {

                showReviewMessage(
                    message,
                    data.message ||
                    "Unable to submit review.",
                    "error"
                );

                return;
            }


            showReviewMessage(
                message,
                data.message ||
                "Thank you! Your review has been submitted.",
                "success"
            );


            setTimeout(
                function () {

                    closeReviewModal();

                },
                1800
            );


        } catch (error) {

            console.error(
                "Review submit error:",
                error
            );

            showReviewMessage(
                message,
                "Something went wrong. Please try again.",
                "error"
            );

        } finally {

            submitButton.disabled = false;

            submitButton.innerHTML =
                `
                    <i class="fa-solid fa-paper-plane"></i>
                    Submit Review
                `;
        }

    }
);


// ---------------------------------------------------------
// REVIEW MESSAGE
// ---------------------------------------------------------

function showReviewMessage(
    element,
    text,
    type
) {

    if (!element) {
        return;
    }

    element.textContent = text;

    element.className =
        "review-form-message " +
        type;
}


// ---------------------------------------------------------
// LOAD REVIEWS WHEN PAGE LOADS
// ---------------------------------------------------------

document.addEventListener(
    "DOMContentLoaded",
    function () {

        loadPatientReviews();

    }
);

/* =========================================================
   GOOGLE REVIEW BUTTON + PATIENT REVIEWS
   NO API / NO BILLING VERSION
========================================================= */


const GOOGLE_REVIEW_LINK =
    "https://maps.app.goo.gl/h5Wc7sBdLGtvZAxM6";


/* =========================================================
   GOOGLE REVIEW BUTTONS
========================================================= */

document.addEventListener(
    "DOMContentLoaded",
    function () {

        const googleButtons =
            document.querySelectorAll(
                ".google-review-link"
            );


        googleButtons.forEach(
            function (button) {

                button.href =
                    GOOGLE_REVIEW_LINK;

                button.target =
                    "_blank";

                button.rel =
                    "noopener noreferrer";

            }
        );

    }
);


/* =========================================================
   LOAD APPROVED PATIENT REVIEWS
========================================================= */

async function loadPatientReviews() {

    const container =
        document.getElementById(
            "reviewsContainer"
        );


    if (!container) {
        return;
    }


    try {

        const response =
            await fetch(
                "/api/reviews"
            );


        const data =
            await response.json();


        if (
            !response.ok ||
            !data.success
        ) {

            container.innerHTML = `
                <div class="review-empty">

                    <i class="fa-regular fa-comment"></i>

                    <h4>
                        Patient reviews are currently unavailable.
                    </h4>

                </div>
            `;

            return;
        }


        const reviews =
            Array.isArray(data.reviews)
                ? data.reviews
                : [];


        if (reviews.length === 0) {

            container.innerHTML = `
                <div class="review-empty">

                    <i class="fa-regular fa-comment"></i>

                    <h4>
                        No patient reviews yet
                    </h4>

                    <p>
                        Be the first patient to share your experience.
                    </p>

                </div>
            `;

            return;
        }


        container.innerHTML =
            reviews
                .map(
                    function (review) {

                        const rating =
                            Math.max(
                                1,
                                Math.min(
                                    5,
                                    Number(
                                        review.rating
                                    ) || 5
                                )
                            );


                        const stars =
                            "★".repeat(
                                rating
                            ) +
                            "☆".repeat(
                                5 - rating
                            );


                        const name =
                            review.patient_name ||
                            "Patient";


                        const text =
                            review.review_text ||
                            "";


                        return `

                            <article
                                class="patient-review-card"
                            >

                                <div
                                    class="patient-review-top"
                                >

                                    <div
                                        class="patient-avatar"
                                    >

                                        ${escapeReviewHtml(
                            name
                                .charAt(0)
                                .toUpperCase()
                        )}

                                    </div>


                                    <div
                                        class="patient-review-info"
                                    >

                                        <h4>

                                            ${escapeReviewHtml(
                            name
                        )}

                                        </h4>


                                        <span>

                                            <i
                                                class="fa-solid fa-circle-check"
                                            ></i>

                                            Verified Patient

                                        </span>

                                    </div>

                                </div>


                                <div
                                    class="patient-review-stars"
                                >

                                    ${stars}

                                </div>


                                <p
                                    class="patient-review-text"
                                >

                                    ${escapeReviewHtml(
                            text
                        )}

                                </p>


                                <div
                                    class="patient-review-footer"
                                >

                                    <span>
                                        Bharat Care Nursing Home
                                    </span>

                                    <span>
                                        Patient Review
                                    </span>

                                </div>

                            </article>

                        `;

                    }
                )
                .join("");


    } catch (error) {

        console.error(
            "Patient review loading error:",
            error
        );


        container.innerHTML = `
            <div class="review-empty">

                Unable to load patient reviews.

            </div>
        `;
    }
}


/* =========================================================
   ESCAPE HTML
========================================================= */

function escapeReviewHtml(
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


/* =========================================================
   LOAD REVIEWS WHEN PAGE OPENS
========================================================= */

document.addEventListener(
    "DOMContentLoaded",
    function () {

        loadPatientReviews();

    }
);



/* =====================================================
   PATIENT REVIEWS + GOOGLE REVIEW
   Bharat Care Nursing Home
===================================================== */





/* =====================================================
   GOOGLE BUTTONS
===================================================== */

document.addEventListener(
    "DOMContentLoaded",
    function () {

        document
            .querySelectorAll(
                ".google-review-link"
            )
            .forEach(
                function (button) {

                    button.href =
                        GOOGLE_REVIEW_LINK;

                    button.target =
                        "_blank";

                    button.rel =
                        "noopener noreferrer";

                }
            );

    }
);


/* =====================================================
   PATIENT REVIEW FORM
===================================================== */

document.addEventListener(
    "DOMContentLoaded",
    function () {

        const reviewForm =
            document.getElementById(
                "patientReviewForm"
            );


        if (!reviewForm) {
            return;
        }


        reviewForm.addEventListener(
            "submit",
            async function (event) {

                event.preventDefault();


                /* -----------------------------------------
                   APPOINTMENT ID
                ----------------------------------------- */

                let appointmentId =
                    document
                        .getElementById(
                            "reviewAppointmentId"
                        )
                        .value
                        .trim();


                /*
                 * Patient can enter:
                 *
                 * #12345
                 * 12345
                 *
                 * We remove # before sending
                 * it to Flask/database.
                 */

                appointmentId =
                    appointmentId
                        .replace(/^#/, "")
                        .trim();


                if (
                    !/^\d+$/.test(
                        appointmentId
                    )
                ) {

                    showToast(
                        "Please enter a valid Appointment ID, for example #12345 or 12345.",
                        "error"
                    );

                    return;
                }


                appointmentId =
                    Number(
                        appointmentId
                    );


                /* -----------------------------------------
                   RATING
                ----------------------------------------- */

                const ratingInput =
                    document.querySelector(
                        'input[name="rating"]:checked'
                    );


                const rating =
                    ratingInput
                        ? Number(
                            ratingInput.value
                        )
                        : 0;


                if (
                    rating < 1 ||
                    rating > 5
                ) {

                    showToast(
                        "Please select a rating from 1 to 5 stars.",
                        "error"
                    );

                    return;
                }


                /* -----------------------------------------
                   REVIEW TEXT
                ----------------------------------------- */

                const reviewText =
                    document
                        .getElementById(
                            "reviewText"
                        )
                        .value
                        .trim();


                if (!reviewText) {

                    showToast(
                        "Please write your experience.",
                        "error"
                    );

                    return;
                }


                /* -----------------------------------------
                   SUBMIT REVIEW
                ----------------------------------------- */

                const submitButton =
                    reviewForm.querySelector(
                        'button[type="submit"]'
                    );


                if (submitButton) {

                    submitButton.disabled =
                        true;

                    submitButton.innerHTML =
                        `
                        <i class="fa-solid fa-spinner fa-spin"></i>
                        Submitting...
                        `;

                }


                try {

                    const response =
                        await fetch(
                            "/api/reviews",
                            {

                                method:
                                    "POST",

                                headers: {
                                    "Content-Type":
                                        "application/json"
                                },

                                body:
                                    JSON.stringify({

                                        appointment_id:
                                            appointmentId,

                                        rating:
                                            rating,

                                        review_text:
                                            reviewText

                                    })

                            }
                        );


                    const data =
                        await response.json();


                    if (
                        response.ok &&
                        data.success
                    ) {

                        showToast(
                            data.message ||
                            "Thank you! Your review has been submitted for verification.",
                            "success"
                        );


                        reviewForm.reset();


                        await loadPatientReviews();


                    } else {

                        showToast(
                            data.message ||
                            "Unable to submit your review.",
                            "error"
                        );

                    }


                } catch (error) {

                    console.error(
                        "Patient review submit error:",
                        error
                    );


                    showToast(
                        "Unable to submit review. Please try again.",
                        "error"
                    );


                } finally {

                    if (submitButton) {

                        submitButton.disabled =
                            false;

                        submitButton.innerHTML =
                            `
                            <i class="fa-solid fa-paper-plane"></i>
                            Submit Review
                            `;

                    }

                }

            }
        );

    }
);


/* =====================================================
   LOAD APPROVED PATIENT REVIEWS
===================================================== */

async function loadPatientReviews() {

    const container =
        document.getElementById(
            "reviewsContainer"
        );


    if (!container) {
        return;
    }


    try {

        const response =
            await fetch(
                "/api/reviews"
            );


        const data =
            await response.json();


        if (
            !response.ok ||
            !data.success
        ) {

            container.innerHTML =
                `
                <div class="review-empty">

                    <i class="fa-solid fa-circle-exclamation"></i>

                    <h4>
                        Unable to load patient reviews.
                    </h4>

                </div>
                `;

            return;
        }


        const reviews =
            Array.isArray(
                data.reviews
            )
                ? data.reviews
                : [];


        /* -----------------------------------------
           NO REVIEWS
        ----------------------------------------- */

        if (
            reviews.length === 0
        ) {

            container.innerHTML =
                `
                <div class="review-empty">

                    <i class="fa-regular fa-comment"></i>

                    <h4>
                        No patient reviews yet
                    </h4>

                    <p>
                        Be the first patient to share your experience.
                    </p>

                </div>
                `;

            return;
        }


        /* -----------------------------------------
           REVIEW CARDS
        ----------------------------------------- */

        container.innerHTML =
            reviews
                .map(
                    function (review) {

                        const rating =
                            Math.max(
                                1,
                                Math.min(
                                    5,
                                    Number(
                                        review.rating
                                    ) || 5
                                )
                            );


                        const stars =
                            "★".repeat(
                                rating
                            ) +
                            "☆".repeat(
                                5 - rating
                            );


                        const patientName =
                            review.patient_name ||
                            "Patient";


                        const reviewText =
                            review.review_text ||
                            "";


                        return `
                        <article
                            class="patient-review-card"
                        >

                            <div
                                class="patient-review-top"
                            >

                                <div
                                    class="patient-avatar"
                                >

                                    ${escapeReviewHtml(
                            patientName
                                .charAt(0)
                                .toUpperCase()
                        )}

                                </div>


                                <div
                                    class="patient-review-info"
                                >

                                    <h4>

                                        ${escapeReviewHtml(
                            patientName
                        )}

                                    </h4>


                                    <span>

                                        <i
                                            class="fa-solid fa-circle-check"
                                        ></i>

                                        Verified Patient

                                    </span>

                                </div>

                            </div>


                            <div
                                class="patient-review-stars"
                            >

                                ${stars}

                            </div>


                            <p
                                class="patient-review-text"
                            >

                                ${escapeReviewHtml(
                            reviewText
                        )}

                            </p>


                            <div
                                class="patient-review-footer"
                            >

                                <span>
                                    Bharat Care Nursing Home
                                </span>

                                <span>
                                    Patient Review
                                </span>

                            </div>

                        </article>
                        `;

                    }
                )
                .join("");


    } catch (error) {

        console.error(
            "Patient review loading error:",
            error
        );


        container.innerHTML =
            `
            <div class="review-empty">

                <i class="fa-solid fa-wifi"></i>

                <h4>
                    Unable to connect to review service.
                </h4>

            </div>
            `;

    }
}


/* =====================================================
   ESCAPE HTML
===================================================== */

function escapeReviewHtml(
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


/* =====================================================
   LOAD REVIEWS WHEN WEBSITE OPENS
===================================================== */

document.addEventListener(
    "DOMContentLoaded",
    function () {

        loadPatientReviews();

    }
);



/* =====================================================
   GOOGLE REVIEW BUTTONS
===================================================== */

document.addEventListener(
    "DOMContentLoaded",
    function () {

        document
            .querySelectorAll(
                ".google-review-link"
            )
            .forEach(function (button) {

                button.href =
                    GOOGLE_REVIEW_LINK;

                button.target =
                    "_blank";

                button.rel =
                    "noopener noreferrer";

            });

    }
);


/* =====================================================
   LOAD PATIENT REVIEWS
===================================================== */

async function loadPatientReviews() {

    const container =
        document.getElementById(
            "reviewsContainer"
        );

    if (!container) {
        return;
    }

    try {

        const response =
            await fetch(
                "/api/reviews"
            );

        const data =
            await response.json();


        if (
            !response.ok ||
            !data.success
        ) {

            container.innerHTML = `
                <div class="review-empty">
                    <i class="fa-solid fa-circle-exclamation"></i>

                    <h4>
                        Unable to load patient reviews.
                    </h4>
                </div>
            `;

            return;
        }


        const reviews =
            Array.isArray(data.reviews)
                ? data.reviews
                : [];


        if (reviews.length === 0) {

            container.innerHTML = `
                <div class="review-empty">

                    <i class="fa-regular fa-comment"></i>

                    <h4>
                        No patient reviews yet
                    </h4>

                    <p>
                        Be the first patient to share your experience.
                    </p>

                </div>
            `;

            return;
        }


        container.innerHTML =
            reviews.map(function (review) {

                const rating =
                    Math.max(
                        1,
                        Math.min(
                            5,
                            Number(
                                review.rating
                            ) || 5
                        )
                    );


                const stars =
                    "★".repeat(rating) +
                    "☆".repeat(5 - rating);


                const patientName =
                    review.patient_name ||
                    "Patient";


                const reviewText =
                    review.review_text ||
                    "";


                return `
                    <article class="patient-review-card">

                        <div class="patient-review-top">

                            <div class="patient-avatar">

                                ${escapeReviewHtml(
                    patientName
                        .charAt(0)
                        .toUpperCase()
                )}

                            </div>


                            <div class="patient-review-info">

                                <h4>
                                    ${escapeReviewHtml(
                    patientName
                )}
                                </h4>

                                <span>
                                    <i class="fa-solid fa-circle-check"></i>
                                    Verified Patient
                                </span>

                            </div>

                        </div>


                        <div class="patient-review-stars">
                            ${stars}
                        </div>


                        <p class="patient-review-text">
                            ${escapeReviewHtml(
                    reviewText
                )}
                        </p>


                        <div class="patient-review-footer">

                            <span>
                                Bharat Care Nursing Home
                            </span>

                            <span>
                                Patient Review
                            </span>

                        </div>

                    </article>
                `;

            }).join("");


    } catch (error) {

        console.error(
            "Patient review loading error:",
            error
        );

        container.innerHTML = `
            <div class="review-empty">

                <i class="fa-solid fa-wifi"></i>

                <h4>
                    Unable to connect to review service.
                </h4>

            </div>
        `;
    }
}


/* =====================================================
   HTML SAFETY
===================================================== */

function escapeReviewHtml(value) {

    const div =
        document.createElement("div");

    div.textContent =
        String(value);

    return div.innerHTML;
}


/* =====================================================
   REVIEW FORM
===================================================== */

document.addEventListener(
    "DOMContentLoaded",
    function () {

        const reviewForm =
            document.getElementById(
                "patientReviewForm"
            );


        if (!reviewForm) {
            return;
        }


        reviewForm.addEventListener(
            "submit",
            async function (event) {

                event.preventDefault();


                /* APPOINTMENT ID */

                let appointmentId =
                    document
                        .getElementById(
                            "reviewAppointmentId"
                        )
                        .value
                        .trim();


                // Accept #12345 and 12345
                appointmentId =
                    appointmentId
                        .replace(/^#/, "")
                        .trim();


                if (
                    !/^\d+$/.test(
                        appointmentId
                    )
                ) {

                    showToast(
                        "Please enter a valid Appointment ID, for example #12345 or 12345.",
                        "error"
                    );

                    return;
                }


                appointmentId =
                    Number(
                        appointmentId
                    );


                /* RATING */

                const ratingInput =
                    document.querySelector(
                        'input[name="rating"]:checked'
                    );


                const rating =
                    ratingInput
                        ? Number(
                            ratingInput.value
                        )
                        : 0;


                if (
                    rating < 1 ||
                    rating > 5
                ) {

                    showToast(
                        "Please select a rating.",
                        "error"
                    );

                    return;
                }


                /* REVIEW TEXT */

                const reviewText =
                    document
                        .getElementById(
                            "reviewText"
                        )
                        .value
                        .trim();


                if (!reviewText) {

                    showToast(
                        "Please write your experience.",
                        "error"
                    );

                    return;
                }


                try {

                    const response =
                        await fetch(
                            "/api/reviews",
                            {

                                method:
                                    "POST",

                                headers: {
                                    "Content-Type":
                                        "application/json"
                                },

                                body:
                                    JSON.stringify({

                                        appointment_id:
                                            appointmentId,

                                        rating:
                                            rating,

                                        review_text:
                                            reviewText

                                    })

                            }
                        );


                    const data =
                        await response.json();


                    if (
                        response.ok &&
                        data.success
                    ) {

                        showToast(
                            data.message ||
                            "Your review has been submitted successfully.",
                            "success"
                        );


                        reviewForm.reset();


                        loadPatientReviews();

                    } else {

                        showToast(
                            data.message ||
                            "Unable to submit review.",
                            "error"
                        );

                    }


                } catch (error) {

                    console.error(
                        "Review submit error:",
                        error
                    );

                    showToast(
                        "Network error. Please try again.",
                        "error"
                    );
                }

            }
        );

    }
);


/* =====================================================
   LOAD REVIEWS WHEN PAGE OPENS
===================================================== */

document.addEventListener(
    "DOMContentLoaded",
    function () {

        loadPatientReviews();

    }
);