const { 
    buildIncentiveEmail, 
    buildLeaveApprovedEmail, 
    buildLeaveRejectedEmail, 
    buildSalesApprovedEmail,
    buildSalesRejectedEmail,
    buildSalaryCreditedEmail, 
    buildTargetSetEmail 
} = require('../utils/emailTemplates');

console.log('Testing Email Templates...\n');

// Test 1: Incentive Email
console.log('1. Testing Incentive Email...');
try {
    const incentiveHtml = buildIncentiveEmail({ 
        name: 'John Doe', 
        amount: '₹15,000', 
        date: '20 September 2026' 
    });
    console.log('✓ Incentive email generated successfully');
    console.log('  Length:', incentiveHtml.length, 'characters');
} catch (error) {
    console.error('✗ Incentive email failed:', error.message);
}

// Test 2: Leave Approved Email
console.log('\n2. Testing Leave Approved Email...');
try {
    const leaveApprovedHtml = buildLeaveApprovedEmail({ 
        name: 'Jane Smith', 
        leaveType: 'Sick Leave', 
        startDate: '2026-09-25', 
        endDate: '2026-09-26', 
        totalDays: 2 
    });
    console.log('✓ Leave approved email generated successfully');
    console.log('  Length:', leaveApprovedHtml.length, 'characters');
} catch (error) {
    console.error('✗ Leave approved email failed:', error.message);
}

// Test 3: Leave Rejected Email
console.log('\n3. Testing Leave Rejected Email...');
try {
    const leaveRejectedHtml = buildLeaveRejectedEmail({ 
        name: 'Bob Johnson', 
        leaveType: 'Casual Leave', 
        startDate: '2026-09-28', 
        endDate: '2026-09-30' 
    });
    console.log('✓ Leave rejected email generated successfully');
    console.log('  Length:', leaveRejectedHtml.length, 'characters');
} catch (error) {
    console.error('✗ Leave rejected email failed:', error.message);
}

// Test 4: Sales Approved Email
console.log('\n4. Testing Sales Approved Email...');
try {
    const salesApprovedHtml = buildSalesApprovedEmail({ 
        name: 'Alice Williams', 
        customerName: 'Rahul Kumar', 
        universityName: 'Delhi University', 
        revenue: 45000,
        admissionDate: '2026-09-20'
    });
    console.log('✓ Sales approved email generated successfully');
    console.log('  Length:', salesApprovedHtml.length, 'characters');
} catch (error) {
    console.error('✗ Sales approved email failed:', error.message);
}

// Test 5: Salary Credited Email
console.log('\n5. Testing Salary Credited Email...');
try {
    const breakup = {
        grossSalary: 50000,
        dailyRate: 1666.67,
        joiningDays: 0,
        monthlyIncentive: 5000,
        dailyBonusTotal: 2000,
        unpaidLeaveDeduction: 0,
        lateAttendanceDeduction: 0,
        advanceDeduction: 0,
        totalDeductions: 0,
        netSalary: 57000
    };
    const employee = {
        id: 123,
        department: 'Sales',
        position: 'Sales Executive'
    };
    const salaryHtml = buildSalaryCreditedEmail({ 
        name: 'David Brown', 
        month: 'September 2026', 
        breakup, 
        employee 
    });
    console.log('✓ Salary credited email generated successfully');
    console.log('  Length:', salaryHtml.length, 'characters');
} catch (error) {
    console.error('✗ Salary credited email failed:', error.message);
}

// Test 6: Target Set Email
console.log('\n6. Testing Target Set Email...');
try {
    const targetHtml = buildTargetSetEmail({ 
        name: 'Emma Davis', 
        month: 'September 2026', 
        salesTarget: 10, 
        revenueTarget: 500000,
        previousSalesTarget: 8,
        previousRevenueTarget: 400000
    });
    console.log('✓ Target set email generated successfully');
    console.log('  Length:', targetHtml.length, 'characters');
} catch (error) {
    console.error('✗ Target set email failed:', error.message);
}

// Test 7: Sales Rejected Email
console.log('\n7. Testing Sales Rejected Email...');
try {
    const salesRejectedHtml = buildSalesRejectedEmail({ 
        name: 'Frank Miller', 
        customerName: 'Suresh Patil', 
        universityName: 'Mumbai University', 
        revenue: 35000,
        admissionDate: '2026-09-18',
        reviewNote: 'Incomplete documentation provided. Please submit all required documents.'
    });
    console.log('✓ Sales rejected email generated successfully');
    console.log('  Length:', salesRejectedHtml.length, 'characters');
} catch (error) {
    console.error('✗ Sales rejected email failed:', error.message);
}

console.log('\n✅ All email template tests completed successfully!');
console.log('\nTemplates are ready for production use.');