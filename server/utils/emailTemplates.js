/**
 * Professional Email Template System for DegreeDrishti HR
 * Provides consistent, beautifully designed email templates
 */

function buildEmailBase({ title, subtitle, badge, badgeColor = 'green' }) {
    const colorSchemes = {
        green: { gradient: 'linear-gradient(135deg,#10b981 0%,#059669 100%)', badgeBg: 'rgba(255,255,255,.2)', badgeBorder: 'rgba(255,255,255,.4)' },
        blue: { gradient: 'linear-gradient(135deg,#3b82f6 0%,#1d4ed8 100%)', badgeBg: 'rgba(255,255,255,.2)', badgeBorder: 'rgba(255,255,255,.4)' },
        red: { gradient: 'linear-gradient(135deg,#ef4444 0%,#dc2626 100%)', badgeBg: 'rgba(255,255,255,.2)', badgeBorder: 'rgba(255,255,255,.4)' },
        purple: { gradient: 'linear-gradient(135deg,#8b5cf6 0%,#7c3aed 100%)', badgeBg: 'rgba(255,255,255,.2)', badgeBorder: 'rgba(255,255,255,.4)' },
        orange: { gradient: 'linear-gradient(135deg,#f97316 0%,#ea580c 100%)', badgeBg: 'rgba(255,255,255,.2)', badgeBorder: 'rgba(255,255,255,.4)' }
    };
    
    const scheme = colorSchemes[badgeColor] || colorSchemes.green;
    
    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${title}</title>
<style>
  body{margin:0;padding:0;background:#f0f4f8;font-family:'Segoe UI',Arial,sans-serif;}
  .wrap{max-width:600px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,.10);}
  .header{background:${scheme.gradient};padding:40px 32px;text-align:center;}
  .header h1{color:#fff;font-size:28px;font-weight:800;margin:0 0 8px;}
  .header p{color:rgba(255,255,255,.85);font-size:15px;margin:0;}
  .badge{display:inline-block;background:${scheme.badgeBg};border:2px solid ${scheme.badgeBorder};border-radius:50px;padding:6px 20px;color:#fff;font-weight:700;font-size:14px;margin-bottom:16px;}
  .body{padding:36px 32px;}
  .greeting{font-size:18px;font-weight:700;color:#111827;margin-bottom:8px;}
  .msg{font-size:14px;color:#4b5563;line-height:1.7;margin-bottom:28px;}
  .card{background:#f9fafb;border:1px solid #e5e7eb;border-radius:14px;padding:24px 28px;margin-bottom:28px;}
  .card-row{display:flex;align-items:center;gap:14px;margin-bottom:12px;}
  .card-row:last-child{margin-bottom:0;}
  .card-icon{font-size:24px;}
  .card-label{font-size:12px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:.05em;}
  .card-value{font-size:16px;font-weight:600;color:#111827;}
  .footer{background:#f9fafb;border-top:1px solid #e5e7eb;padding:24px 32px;text-align:center;}
  .footer p{font-size:12px;color:#9ca3af;margin:4px 0;}
  .footer strong{color:#374151;}
</style></head>
<body>
<div class="wrap">
  <div class="header">
    ${badge ? `<div class="badge">${badge}</div>` : ''}
    <h1>${title}</h1>
    <p>${subtitle}</p>
  </div>
  <div class="body">`;
}

function buildEmailFooter() {
    return `    <div class="footer">
    <p><strong>DegreeDrishti HR Portal</strong></p>
    <p>This is an automated message. Please do not reply to this email.</p>
    <p style="margin-top:8px;font-size:11px;">© ${new Date().getFullYear()} DegreeDrishti. All rights reserved.</p>
  </div>
</div>
</body></html>`;
}

function buildIncentiveEmail({ name, amount, date }) {
    const base = buildEmailBase({
        title: 'Congratulations!',
        subtitle: 'Your performance incentive has been successfully processed.',
        badge: '🎉 Incentive Credited',
        badgeColor: 'green'
    });
    
    const body = `    <div class="greeting">Hi ${name},</div>
    <p class="msg">We're delighted to inform you that your performance incentive has been successfully processed and marked as paid. Your dedication, commitment, and hard work have made a valuable contribution to the company's success.</p>
    <div class="card">
      <div class="card-row"><span class="card-icon">💰</span><div><div class="card-label">Incentive Amount</div><div class="card-value">${amount}</div></div></div>
      <div class="card-row"><span class="card-icon">📅</span><div><div class="card-label">Payment Date</div><div class="card-value">${date}</div></div></div>
    </div>
    <p class="msg">Thank you for your outstanding efforts and continued excellence. Keep up the amazing work — we look forward to celebrating many more achievements with you!</p>
    <p class="msg" style="font-weight:600;color:#374151;">Best Regards,<br>HR Team<br>DegreeDrishti</p>`;
    
    return base + body + buildEmailFooter();
}

function buildLeaveApprovedEmail({ name, leaveType, startDate, endDate, totalDays }) {
    const base = buildEmailBase({
        title: 'Leave Approved',
        subtitle: 'Your leave request has been approved.',
        badge: '✅ Leave Approved',
        badgeColor: 'green'
    });
    
    const body = `    <div class="greeting">Hi ${name},</div>
    <p class="msg">Good news! Your leave request has been approved. Please ensure proper handover of your responsibilities before your leave begins.</p>
    <div class="card">
      <div class="card-row"><span class="card-icon">📋</span><div><div class="card-label">Leave Type</div><div class="card-value">${leaveType}</div></div></div>
      <div class="card-row"><span class="card-icon">📅</span><div><div class="card-label">Start Date</div><div class="card-value">${startDate}</div></div></div>
      <div class="card-row"><span class="card-icon">📅</span><div><div class="card-label">End Date</div><div class="card-value">${endDate}</div></div></div>
      <div class="card-row"><span class="card-icon">⏱️</span><div><div class="card-label">Total Days</div><div class="card-value">${totalDays} day(s)</div></div></div>
    </div>
    <p class="msg">If you have any questions or need to make changes to your leave, please contact HR.</p>
    <p class="msg" style="font-weight:600;color:#374151;">Best Regards,<br>HR Team<br>DegreeDrishti</p>`;
    
    return base + body + buildEmailFooter();
}

function buildLeaveRejectedEmail({ name, leaveType, startDate, endDate }) {
    const base = buildEmailBase({
        title: 'Leave Request Update',
        subtitle: 'Your leave request could not be approved at this time.',
        badge: '❌ Leave Rejected',
        badgeColor: 'red'
    });
    
    const body = `    <div class="greeting">Hi ${name},</div>
    <p class="msg">We regret to inform you that your leave request has been rejected. This decision was made after careful consideration of business requirements and team availability.</p>
    <div class="card">
      <div class="card-row"><span class="card-icon">📋</span><div><div class="card-label">Leave Type</div><div class="card-value">${leaveType}</div></div></div>
      <div class="card-row"><span class="card-icon">📅</span><div><div class="card-label">Requested Dates</div><div class="card-value">${startDate} to ${endDate}</div></div></div>
    </div>
    <p class="msg">If you believe this decision needs review or if you'd like to discuss alternative dates, please contact HR.</p>
    <p class="msg" style="font-weight:600;color:#374151;">Best Regards,<br>HR Team<br>DegreeDrishti</p>`;
    
    return base + body + buildEmailFooter();
}

function buildSalesApprovedEmail({ name, customerName, universityName, revenue, admissionDate }) {
    const base = buildEmailBase({
        title: 'Sales Record Approved',
        subtitle: 'Your admission has been successfully recorded and approved.',
        badge: '🎯 Sales Approved',
        badgeColor: 'blue'
    });
    
    const formattedRevenue = `₹${Number(revenue).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    
    const body = `    <div class="greeting">Hi ${name},</div>
    <p class="msg">Great work! Your sales record has been approved and the admission has been successfully processed. Your contribution helps us grow and achieve our targets.</p>
    <div class="card">
      <div class="card-row"><span class="card-icon">👤</span><div><div class="card-label">Student Name</div><div class="card-value">${customerName}</div></div></div>
      <div class="card-row"><span class="card-icon">🎓</span><div><div class="card-label">University</div><div class="card-value">${universityName}</div></div></div>
      <div class="card-row"><span class="card-icon">💰</span><div><div class="card-label">Revenue</div><div class="card-value">${formattedRevenue}</div></div></div>
      ${admissionDate ? `<div class="card-row"><span class="card-icon">📅</span><div><div class="card-label">Admission Date</div><div class="card-value">${admissionDate}</div></div></div>` : ''}
    </div>
    <p class="msg">Thank you for your dedication and effort in bringing this admission. Keep up the excellent work!</p>
    <p class="msg" style="font-weight:600;color:#374151;">Best Regards,<br>HR Team<br>DegreeDrishti</p>`;
    
    return base + body + buildEmailFooter();
}

function buildSalaryCreditedEmail({ name, month, breakup, employee }) {
    const formatRupees = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    
    const base = buildEmailBase({
        title: 'Salary Credited',
        subtitle: `Your salary for ${month} has been successfully processed.`,
        badge: '💳 Salary Credited',
        badgeColor: 'green'
    });
    
    const body = `    <div class="greeting">Hi ${name},</div>
    <p class="msg">Your salary for <strong>${month}</strong> has been credited to your account. Below is the detailed breakup for your reference.</p>
    <div class="card">
      <div class="card-row"><span class="card-icon">🆔</span><div><div class="card-label">Employee ID</div><div class="card-value">${employee.id}</div></div></div>
      <div class="card-row"><span class="card-icon">🏢</span><div><div class="card-label">Department</div><div class="card-value">${employee.department || '—'}</div></div></div>
      <div class="card-row"><span class="card-icon">💼</span><div><div class="card-label">Designation</div><div class="card-value">${employee.position || employee.designation || '—'}</div></div></div>
    </div>
    <div class="card">
      <div class="card-row"><span class="card-icon">💰</span><div><div class="card-label">Gross Salary</div><div class="card-value">${formatRupees(breakup.grossSalary)}</div></div></div>
      <div class="card-row"><span class="card-icon">📊</span><div><div class="card-label">Daily Rate</div><div class="card-value">${formatRupees(breakup.dailyRate)} / day</div></div></div>
      ${breakup.joiningDays > 0 ? `<div class="card-row"><span class="card-icon">⏱️</span><div><div class="card-label">Pro-rated Days</div><div class="card-value">${breakup.joiningDays} days</div></div></div>` : ''}
      ${breakup.monthlyIncentive > 0 ? `<div class="card-row"><span class="card-icon">🎁</span><div><div class="card-label">Monthly Incentive</div><div class="card-value">${formatRupees(breakup.monthlyIncentive)}</div></div></div>` : ''}
      ${breakup.dailyBonusTotal > 0 ? `<div class="card-row"><span class="card-icon">🎯</span><div><div class="card-label">Daily Bonuses</div><div class="card-value">${formatRupees(breakup.dailyBonusTotal)}</div></div></div>` : ''}
      ${breakup.unpaidLeaveDeduction > 0 ? `<div class="card-row"><span class="card-icon">➖</span><div><div class="card-label">Leave Deduction</div><div class="card-value">-${formatRupees(breakup.unpaidLeaveDeduction)}</div></div></div>` : ''}
      ${breakup.lateAttendanceDeduction > 0 ? `<div class="card-row"><span class="card-icon">⏰</span><div><div class="card-label">Late Deduction</div><div class="card-value">-${formatRupees(breakup.lateAttendanceDeduction)}</div></div></div>` : ''}
      ${breakup.advanceDeduction > 0 ? `<div class="card-row"><span class="card-icon">📉</span><div><div class="card-label">Advance Deduction</div><div class="card-value">-${formatRupees(breakup.advanceDeduction)}</div></div></div>` : ''}
      <div class="card-row" style="margin-top:16px;padding-top:16px;border-top:1px solid #e5e7eb;"><span class="card-icon">💵</span><div><div class="card-label">Net Salary</div><div class="card-value" style="font-size:18px;font-weight:800;color:#059669;">${formatRupees(breakup.netSalary)}</div></div></div>
    </div>
    <p class="msg">If you have any questions about your salary breakup, please contact HR.</p>
    <p class="msg" style="font-weight:600;color:#374151;">Best Regards,<br>HR Team<br>DegreeDrishti</p>`;
    
    return base + body + buildEmailFooter();
}

function buildTargetSetEmail({ name, month, salesTarget, revenueTarget, previousSalesTarget, previousRevenueTarget }) {
    const base = buildEmailBase({
        title: 'Monthly Target Assigned',
        subtitle: `Your targets for ${month} have been updated.`,
        badge: '🎯 Target Set',
        badgeColor: 'purple'
    });
    
    const body = `    <div class="greeting">Hi ${name},</div>
    <p class="msg">Your monthly targets have been set for <strong>${month}</strong>. Please review the targets below and plan your activities accordingly to achieve them.</p>
    <div class="card">
      <div class="card-row"><span class="card-icon">🎯</span><div><div class="card-label">Sales Target</div><div class="card-value">${salesTarget ?? 0} admissions</div></div></div>
      ${revenueTarget ? `<div class="card-row"><span class="card-icon">💰</span><div><div class="card-label">Revenue Target</div><div class="card-value">₹${Number(revenueTarget).toLocaleString('en-IN')}</div></div></div>` : ''}
    </div>
    ${(previousSalesTarget > 0 || previousRevenueTarget > 0) ? `
    <div class="card" style="background:#f0fdf4;border-color:#86efac;">
      <div class="card-row"><span class="card-icon">📊</span><div><div class="card-label">Previous Sales Target</div><div class="card-value">${previousSalesTarget ?? 0} admissions</div></div></div>
      ${previousRevenueTarget ? `<div class="card-row"><span class="card-icon">💰</span><div><div class="card-label">Previous Revenue Target</div><div class="card-value">₹${Number(previousRevenueTarget).toLocaleString('en-IN')}</div></div></div>` : ''}
    </div>` : ''}
    <p class="msg">We believe in your potential and are confident you'll achieve these targets. Good luck!</p>
    <p class="msg" style="font-weight:600;color:#374151;">Best Regards,<br>HR Team<br>DegreeDrishti</p>`;
    
    return base + body + buildEmailFooter();
}

function buildSalesRejectedEmail({ name, customerName, universityName, revenue, admissionDate, reviewNote }) {
    const base = buildEmailBase({
        title: 'Sales Record Update',
        subtitle: 'Your admission record could not be approved at this time.',
        badge: '❌ Admission Rejected',
        badgeColor: 'red'
    });
    
    const formattedRevenue = `₹${Number(revenue).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    
    const body = `    <div class="greeting">Hi ${name},</div>
    <p class="msg">We regret to inform you that your admission record has been rejected. This decision was made after careful review of the submission details.</p>
    <div class="card">
      <div class="card-row"><span class="card-icon">👤</span><div><div class="card-label">Student Name</div><div class="card-value">${customerName}</div></div></div>
      <div class="card-row"><span class="card-icon">🎓</span><div><div class="card-label">University</div><div class="card-value">${universityName}</div></div></div>
      <div class="card-row"><span class="card-icon">💰</span><div><div class="card-label">Revenue</div><div class="card-value">${formattedRevenue}</div></div></div>
      ${admissionDate ? `<div class="card-row"><span class="card-icon">📅</span><div><div class="card-label">Admission Date</div><div class="card-value">${admissionDate}</div></div></div>` : ''}
    </div>
    ${reviewNote ? `<div class="card" style="background:#fef2f2;border-color:#fecaca;"><div class="card-row"><span class="card-icon">📝</span><div><div class="card-label">Review Note</div><div class="card-value">${reviewNote}</div></div></div></div>` : ''}
    <p class="msg">If you believe this decision needs review or if you have additional information to provide, please contact HR with the updated details.</p>
    <p class="msg" style="font-weight:600;color:#374151;">Best Regards,<br>HR Team<br>DegreeDrishti</p>`;
    
    return base + body + buildEmailFooter();
}

module.exports = {
    buildIncentiveEmail,
    buildLeaveApprovedEmail,
    buildLeaveRejectedEmail,
    buildSalesApprovedEmail,
    buildSalesRejectedEmail,
    buildSalaryCreditedEmail,
    buildTargetSetEmail
};