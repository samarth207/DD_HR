const { ObjectId } = require('mongodb');

class AdmissionAccessError extends Error {
    constructor(statusCode, message) {
        super(message);
        this.statusCode = statusCode;
    }
}

function isManagementRole(req) {
    return !req?.auth || req.auth.role === 'admin' || req.auth.role === 'hr';
}

function getEmployeeScope(req, requestedEmployeeId) {
    if (!req?.auth) return requestedEmployeeId === undefined ? null : Number(requestedEmployeeId);

    if (req.auth.role === 'employee') {
        const employeeId = Number(req.auth.employeeId);
        if (!Number.isInteger(employeeId)) throw new AdmissionAccessError(403, 'Forbidden');
        if (requestedEmployeeId !== undefined && Number(requestedEmployeeId) !== employeeId) {
            throw new AdmissionAccessError(403, 'Forbidden');
        }
        return employeeId;
    }

    if (req.auth.role !== 'admin' && req.auth.role !== 'hr') {
        throw new AdmissionAccessError(403, 'Forbidden');
    }
    if (requestedEmployeeId === undefined) return null;
    const employeeId = Number(requestedEmployeeId);
    if (!Number.isInteger(employeeId)) throw new AdmissionAccessError(400, 'Invalid employeeId');
    return employeeId;
}

async function getAccessibleAdmission(db, admissionId, req) {
    if (!ObjectId.isValid(admissionId)) throw new AdmissionAccessError(400, 'Invalid admission ID');
    if (req?.auth && !['admin', 'hr', 'employee'].includes(req.auth.role)) {
        throw new AdmissionAccessError(403, 'Forbidden');
    }

    const admission = await db.collection('admissions').findOne({ _id: new ObjectId(admissionId) });
    if (!admission) throw new AdmissionAccessError(404, 'Admission not found');
    if (req?.auth?.role === 'employee' && Number(admission.employeeId) !== Number(req.auth.employeeId)) {
        throw new AdmissionAccessError(403, 'Forbidden');
    }
    return admission;
}

module.exports = {
    AdmissionAccessError,
    getAccessibleAdmission,
    getEmployeeScope,
    isManagementRole
};