async function ensureAdmissionManagementIndexes(db) {
    await db.collection('admissions').createIndex(
        { admissionYear: 1, admissionDrive: 1, status: 1, courseId: 1 },
        { name: 'admissions_year_drive_status_course' }
    );
    await db.collection('admissions').createIndex(
        { employeeId: 1, admissionYear: 1, admissionDrive: 1, status: 1, admissionDate: -1 },
        { name: 'admissions_employee_year_drive_status_date' }
    );

    const schedules = db.collection('admissionReRegistrations');
    await schedules.createIndex({ admissionId: 1 }, { unique: true, name: 'rereg_admission_unique' });
    await schedules.createIndex(
        { employeeId: 1, admissionYear: 1, admissionDrive: 1 },
        { name: 'rereg_employee_year_drive' }
    );
    await schedules.createIndex(
        { 'periods.periodId': 1, 'periods.status': 1 },
        { name: 'rereg_period_status' }
    );
}

module.exports = { ensureAdmissionManagementIndexes };