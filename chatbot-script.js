// Chatbot Functions
let chatHistory = [];

document.addEventListener('DOMContentLoaded', function() {
    loadChatHistory();
});

function sendMessage(event) {
    event.preventDefault();
    
    const input = document.getElementById('chatInput');
    const message = input.value.trim();
    
    if (!message) return;
    
    // Add user message to chat
    addMessage(message, 'user');
    input.value = '';
    
    // Process command
    setTimeout(() => {
        processCommand(message);
    }, 500);
}

function addMessage(text, type) {
    const messagesContainer = document.getElementById('chatMessages');
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${type}`;
    
    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.innerHTML = type === 'user' ? '<i class="fas fa-user"></i>' : '<i class="fas fa-robot"></i>';
    
    const content = document.createElement('div');
    content.className = 'message-content';
    
    const textDiv = document.createElement('div');
    textDiv.className = 'message-text';
    textDiv.innerHTML = text;
    
    content.appendChild(textDiv);
    messageDiv.appendChild(avatar);
    messageDiv.appendChild(content);
    
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    
    // Save to history
    chatHistory.push({ text, type, timestamp: new Date().toISOString() });
    saveChatHistory();
}

function processCommand(command) {
    const lowerCommand = command.toLowerCase();
    
    // Enhanced natural language understanding
    
    // Add/increase leave balance - multiple patterns
    if ((lowerCommand.includes('add') || lowerCommand.includes('give') || lowerCommand.includes('credit') || lowerCommand.includes('increase')) && 
        (lowerCommand.includes('leave') || lowerCommand.includes('day'))) {
        handleAddLeave(command);
    }
    // Remove/deduct leave balance - multiple patterns
    else if ((lowerCommand.includes('remove') || lowerCommand.includes('deduct') || lowerCommand.includes('subtract') || 
              lowerCommand.includes('take away') || lowerCommand.includes('reduce')) && lowerCommand.includes('leave')) {
        handleRemoveLeave(command);
    }
    // Approve leave - multiple patterns
    else if ((lowerCommand.includes('approve') || lowerCommand.includes('accept') || lowerCommand.includes('grant')) && 
             lowerCommand.includes('leave')) {
        handleApproveLeave(command);
    }
    // Reject leave - multiple patterns
    else if ((lowerCommand.includes('reject') || lowerCommand.includes('deny') || lowerCommand.includes('decline')) && 
             lowerCommand.includes('leave')) {
        handleRejectLeave(command);
    }
    // Show/list pending leaves
    else if ((lowerCommand.includes('show') || lowerCommand.includes('list') || lowerCommand.includes('get') || lowerCommand.includes('display')) && 
             lowerCommand.includes('pending')) {
        handleShowPendingLeaves();
    }
    // Add holiday
    else if ((lowerCommand.includes('add') || lowerCommand.includes('create') || lowerCommand.includes('new')) && 
             lowerCommand.includes('holiday')) {
        handleAddHoliday(command);
    }
    // Remove/delete holiday
    else if ((lowerCommand.includes('remove') || lowerCommand.includes('delete')) && lowerCommand.includes('holiday')) {
        handleRemoveHoliday(command);
    }
    // Show employee info
    else if ((lowerCommand.includes('show') || lowerCommand.includes('get') || lowerCommand.includes('display') || 
              lowerCommand.includes('info') || lowerCommand.includes('details')) && 
             (lowerCommand.includes('employee') || lowerCommand.includes('staff') || lowerCommand.includes('worker'))) {
        handleShowEmployee(command);
    }
    // List all employees
    else if ((lowerCommand.includes('list') || lowerCommand.includes('show all')) && 
             (lowerCommand.includes('employee') || lowerCommand.includes('staff'))) {
        handleListEmployees();
    }
    // Show leave balance
    else if (lowerCommand.includes('balance') || 
             (lowerCommand.includes('how many') && lowerCommand.includes('leave'))) {
        handleShowLeaveBalance(command);
    }
    // Report/stats
    else if (lowerCommand.includes('report') || lowerCommand.includes('stats') || lowerCommand.includes('statistics')) {
        handleGenerateReport(command);
    }
    // Find/search employees
    else if ((lowerCommand.includes('find') || lowerCommand.includes('search')) && 
             (lowerCommand.includes('employee') || lowerCommand.includes('staff'))) {
        handleSearchEmployees(command);
    }
    // Help command
    else if (lowerCommand.includes('help') || lowerCommand === 'what can you do' || lowerCommand.includes('command')) {
        showHelp();
    }
    else {
        provideSuggestions(command);
    }
}

function handleAddLeave(command) {
    // Enhanced parsing: "add 0.5 leave for john for 27th december 2025"
    // Also handles: "give john 2 days leave", "credit 1.5 leave to jane"
    
    const leaveMatch = command.match(/(?:add|give|credit|increase)\s+(\d+\.?\d*)\s*(?:day|leave)/i) || 
                      command.match(/(\d+\.?\d*)\s*(?:day|leave)/i);
    
    const nameMatch = command.match(/(?:for|to|give)\s+([a-z]+(?:\s+[a-z]+)?)/i);
    
    if (!leaveMatch) {
        addMessage("Please specify the number of days. Example: 'add 2 leave for John' or 'give Jane 1.5 days'", 'bot');
        return;
    }
    
    if (!nameMatch) {
        addMessage("Please specify the employee name. Example: 'add 2 leave for John'", 'bot');
        return;
    }
    
    const amount = parseFloat(leaveMatch[1]);
    const name = nameMatch[1].trim();
    
    const employees = getEmployees();
    const employee = employees.find(e => 
        e.firstName.toLowerCase().includes(name.toLowerCase()) || 
        e.lastName.toLowerCase().includes(name.toLowerCase()) ||
        `${e.firstName} ${e.lastName}`.toLowerCase().includes(name.toLowerCase())
    );
    
    if (!employee) {
        const suggestions = employees.slice(0, 3).map(e => `${e.firstName} ${e.lastName}`).join(', ');
        addMessage(`Employee "${name}" not found. Did you mean one of these: ${suggestions}?`, 'bot');
        return;
    }
    
    // Detect leave type from command - all leave types use paidLeave balance
    let leaveType = 'paidLeave';
    
    if (!employee.leaveBalance) {
        employee.leaveBalance = { paidLeave: 0 };
    }
    // Migrate legacy structure
    if (employee.leaveBalance.paidLeave === undefined) {
        employee.leaveBalance.paidLeave = (employee.leaveBalance.annualLeave || 0) + (employee.leaveBalance.sickLeave || 0) + (employee.leaveBalance.personalLeave || 0);
    }
    
    employee.leaveBalance.paidLeave += amount;
    saveEmployees(employees);
    addLog('edit', `Added ${amount} days of paid leave to ${employee.firstName} ${employee.lastName} via AI Assistant`);
    
    addMessage(`✅ Successfully added ${amount} day(s) to ${employee.firstName} ${employee.lastName}'s Paid Leave.<br><br><strong>Updated Balance:</strong><br>Paid Leave: ${employee.leaveBalance.paidLeave} days`, 'bot');
}

function handleRemoveLeave(command) {
    const leaveMatch = command.match(/(?:remove|deduct)\s+([\d.]+)\s+leave/i);
    const nameMatch = command.match(/(?:from|for)\s+(\w+)/i);
    
    if (!leaveMatch || !nameMatch) {
        addMessage("Please specify the amount and employee name. Example: 'remove 1 leave from John'", 'bot');
        return;
    }
    
    const amount = parseFloat(leaveMatch[1]);
    const name = nameMatch[1];
    
    const employees = getEmployees();
    const employee = employees.find(e => 
        e.firstName.toLowerCase().includes(name.toLowerCase()) || 
        e.lastName.toLowerCase().includes(name.toLowerCase())
    );
    
    if (!employee) {
        addMessage(`Employee "${name}" not found.`, 'bot');
        return;
    }
    
    if (!employee.leaveBalance) {
        employee.leaveBalance = { paidLeave: 0 };
    }
    // Migrate legacy structure
    if (employee.leaveBalance.paidLeave === undefined) {
        employee.leaveBalance.paidLeave = employee.leaveBalance.annualLeave || 0;
    }
    
    employee.leaveBalance.paidLeave = Math.max(0, employee.leaveBalance.paidLeave - amount);
    saveEmployees(employees);
    addLog('edit', `Removed ${amount} days of leave from ${employee.firstName} ${employee.lastName} via AI Assistant`);
    
    addMessage(`✅ Successfully removed ${amount} day(s) from ${employee.firstName} ${employee.lastName}'s leave balance.<br><br>New balance: ${employee.leaveBalance.paidLeave} days`, 'bot');
}

function handleApproveLeave(command) {
    const nameMatch = command.match(/for\s+(\w+)/i);
    
    if (!nameMatch) {
        addMessage("Please specify the employee name. Example: 'approve leave for John'", 'bot');
        return;
    }
    
    const name = nameMatch[1];
    const employees = getEmployees();
    const employee = employees.find(e => 
        e.firstName.toLowerCase().includes(name.toLowerCase()) || 
        e.lastName.toLowerCase().includes(name.toLowerCase())
    );
    
    if (!employee) {
        addMessage(`Employee "${name}" not found.`, 'bot');
        return;
    }
    
    const leaves = getLeaves();
    const pendingLeave = leaves.find(l => 
        l.employeeId === employee.id && l.status === 'pending'
    );
    
    if (!pendingLeave) {
        addMessage(`No pending leave requests found for ${employee.firstName} ${employee.lastName}.`, 'bot');
        return;
    }
    
    pendingLeave.status = 'approved';
    
    // Deduct leave balance from paidLeave
    const days = calculateLeaveDays(pendingLeave.startDate, pendingLeave.endDate, pendingLeave.halfDay === true || pendingLeave.leaveType === 'Half Day');
    if (!employee.leaveBalance) employee.leaveBalance = { paidLeave: 0 };
    if (employee.leaveBalance.paidLeave === undefined) {
        employee.leaveBalance.paidLeave = (employee.leaveBalance.annualLeave || 0) + (employee.leaveBalance.sickLeave || 0) + (employee.leaveBalance.personalLeave || 0);
    }
    if (pendingLeave.leaveType !== 'Unpaid Leave' && pendingLeave.leaveType !== 'Maternity Leave' && pendingLeave.leaveType !== 'Paternity Leave') {
        employee.leaveBalance.paidLeave = Math.max(0, employee.leaveBalance.paidLeave - days);
        apiCall(`/employees/${employee.id}`, 'PUT', employee).catch(e => console.error('Failed to update employee balance:', e));
    }
    
    apiCall(`/leaves/${pendingLeave.id}`, 'PUT', pendingLeave)
        .catch(e => console.error('Failed to update leave status:', e));
    addLog('edit', `Approved leave for ${employee.firstName} ${employee.lastName} via AI Assistant`);
    
    addMessage(`✅ Leave request approved for ${employee.firstName} ${employee.lastName}<br>Type: ${pendingLeave.leaveType}<br>Duration: ${days} day(s)<br>Dates: ${pendingLeave.startDate} to ${pendingLeave.endDate}`, 'bot');
}

function handleRejectLeave(command) {
    const nameMatch = command.match(/for\s+(\w+)/i);
    
    if (!nameMatch) {
        addMessage("Please specify the employee name. Example: 'reject leave for John'", 'bot');
        return;
    }
    
    const name = nameMatch[1];
    const employees = getEmployees();
    const employee = employees.find(e => 
        e.firstName.toLowerCase().includes(name.toLowerCase()) || 
        e.lastName.toLowerCase().includes(name.toLowerCase())
    );
    
    if (!employee) {
        addMessage(`Employee "${name}" not found.`, 'bot');
        return;
    }
    
    const leaves = getLeaves();
    const pendingLeave = leaves.find(l => 
        l.employeeId === employee.id && l.status === 'pending'
    );
    
    if (!pendingLeave) {
        addMessage(`No pending leave requests found for ${employee.firstName} ${employee.lastName}.`, 'bot');
        return;
    }
    
    pendingLeave.status = 'rejected';
    saveLeaves(leaves);
    addLog('edit', `Rejected leave for ${employee.firstName} ${employee.lastName} via AI Assistant`);
    
    addMessage(`✅ Leave request rejected for ${employee.firstName} ${employee.lastName}`, 'bot');
}

function handleShowPendingLeaves() {
    const leaves = getLeaves();
    const employees = getEmployees();
    const pending = leaves.filter(l => l.status === 'pending');
    
    if (pending.length === 0) {
        addMessage("No pending leave requests at the moment.", 'bot');
        return;
    }
    
    let response = `<strong>Pending Leave Requests (${pending.length}):</strong><br><br>`;
    pending.forEach((leave, index) => {
        const employee = employees.find(e => e.id === leave.employeeId);
        const empName = employee ? `${employee.firstName} ${employee.lastName}` : 'Unknown';
        const days = calculateLeaveDays(leave.startDate, leave.endDate, leave.halfDay === true || leave.leaveType === 'Half Day');
        
        response += `${index + 1}. <strong>${empName}</strong><br>`;
        response += `   Type: ${leave.leaveType}<br>`;
        response += `   Duration: ${days} day(s)<br>`;
        response += `   Dates: ${leave.startDate} to ${leave.endDate}<br>`;
        response += `   Reason: ${leave.reason || 'N/A'}<br><br>`;
    });
    
    addMessage(response, 'bot');
}

function handleAddHoliday(command) {
    // Parse: "add holiday on 26th January" or "add holiday republic day on 2026-01-26"
    const dateMatch = command.match(/(\d{4}-\d{2}-\d{2})/);
    
    if (!dateMatch) {
        addMessage("Please specify a date in format YYYY-MM-DD. Example: 'add holiday on 2026-01-26'", 'bot');
        return;
    }
    
    const date = dateMatch[1];
    const nameMatch = command.match(/holiday\s+(.+?)\s+on/i);
    const name = nameMatch ? nameMatch[1] : 'New Holiday';
    
    const holidays = getHolidays();
    const newHoliday = {
        id: Date.now(),
        name: name,
        date: date,
        type: 'Public Holiday',
        description: 'Added via AI Assistant',
        recurring: false
    };
    
    holidays.push(newHoliday);
    saveHolidays(holidays);
    addLog('add', `Added holiday "${name}" on ${date} via AI Assistant`);
    
    addMessage(`✅ Holiday added successfully!<br><br>Name: ${name}<br>Date: ${date}`, 'bot');
}

function handleShowEmployee(command) {
    const nameMatch = command.match(/employee\s+(\w+)/i);
    
    if (!nameMatch) {
        addMessage("Please specify the employee name. Example: 'show employee John'", 'bot');
        return;
    }
    
    const name = nameMatch[1];
    const employees = getEmployees();
    const employee = employees.find(e => 
        e.firstName.toLowerCase().includes(name.toLowerCase()) || 
        e.lastName.toLowerCase().includes(name.toLowerCase())
    );
    
    if (!employee) {
        addMessage(`Employee "${name}" not found.`, 'bot');
        return;
    }
    
    const leaveBalance = employee.leaveBalance || { paidLeave: 0 };
    const paidLeave = leaveBalance.paidLeave ?? (leaveBalance.annualLeave || 0);
    
    let response = `<strong>${employee.firstName} ${employee.lastName}</strong><br><br>`;
    response += `📧 Email: ${employee.email}<br>`;
    response += `🏢 Department: ${employee.department}<br>`;
    response += `💼 Position: ${employee.position}<br>`;
    response += `📅 Hire Date: ${employee.hireDate}<br>`;
    response += `📊 Status: ${employee.status}<br><br>`;
    response += `<strong>Leave Balance:</strong><br>`;
    response += `💰 Paid Leave: ${paidLeave} days<br>`;
    
    if (employee.companyEmail) {
        response += `<br>🏢 Company Email: ${employee.companyEmail}`;
    }
    
    addMessage(response, 'bot');
}

function handleListEmployees() {
    const employees = getEmployees();
    
    if (employees.length === 0) {
        addMessage("No employees found in the system.", 'bot');
        return;
    }
    
    let response = `<strong>All Employees (${employees.length}):</strong><br><br>`;
    employees.forEach((emp, index) => {
        response += `${index + 1}. <strong>${emp.firstName} ${emp.lastName}</strong> - ${emp.department} (${emp.position})<br>`;
    });
    
    addMessage(response, 'bot');
}

function handleShowLeaveBalance(command) {
    const nameMatch = command.match(/(?:for|of)\s+(\w+)/i);
    
    if (!nameMatch) {
        addMessage("Please specify the employee name. Example: 'show leave balance for John'", 'bot');
        return;
    }
    
    const name = nameMatch[1];
    const employees = getEmployees();
    const employee = employees.find(e => 
        e.firstName.toLowerCase().includes(name.toLowerCase()) || 
        e.lastName.toLowerCase().includes(name.toLowerCase())
    );
    
    if (!employee) {
        addMessage(`Employee "${name}" not found.`, 'bot');
        return;
    }
    
    const leaveBalance = employee.leaveBalance || { paidLeave: 0 };
    const paidLeave = leaveBalance.paidLeave ?? (leaveBalance.annualLeave || 0);
    
    let response = `<strong>Leave Balance for ${employee.firstName} ${employee.lastName}:</strong><br><br>`;
    response += `💰 Paid Leave: ${paidLeave} days<br>`;
    
    addMessage(response, 'bot');
}

function calculateLeaveDays(startDate, endDate, isHalfDay) {
    if (isHalfDay) return 0.5;
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffTime = Math.abs(end - start);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    return diffDays;
}

function clearChat() {
    if (confirm('Are you sure you want to clear the chat history?')) {
        chatHistory = [];
        saveChatHistory();
        document.getElementById('chatMessages').innerHTML = `
            <div class="chat-message bot">
                <div class="message-avatar">
                    <i class="fas fa-robot"></i>
                </div>
                <div class="message-content">
                    <div class="message-text">
                        Chat cleared. How can I help you today?
                    </div>
                </div>
            </div>
        `;
    }
}

function saveChatHistory() {
    localStorage.setItem('hrChatHistory', JSON.stringify(chatHistory));
}

function loadChatHistory() {
    const saved = localStorage.getItem('hrChatHistory');
    if (saved) {
        chatHistory = JSON.parse(saved);
        const messagesContainer = document.getElementById('chatMessages');
        
        // Clear initial message
        messagesContainer.innerHTML = '';
        
        // Restore messages
        chatHistory.forEach(msg => {
            const messageDiv = document.createElement('div');
            messageDiv.className = `chat-message ${msg.type}`;
            
            const avatar = document.createElement('div');
            avatar.className = 'message-avatar';
            avatar.innerHTML = msg.type === 'user' ? '<i class="fas fa-user"></i>' : '<i class="fas fa-robot"></i>';
            
            const content = document.createElement('div');
            content.className = 'message-content';
            
            const textDiv = document.createElement('div');
            textDiv.className = 'message-text';
            textDiv.innerHTML = msg.text;
            
            content.appendChild(textDiv);
            messageDiv.appendChild(avatar);
            messageDiv.appendChild(content);
            
            messagesContainer.appendChild(messageDiv);
        });
        
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
}

// New intelligent functions

function handleGenerateReport(command) {
    const employees = getEmployees();
    const leaves = getLeaves();
    
    let response = '<strong>📊 HR Statistics Report</strong><br><br>';
    
    // Employee stats
    const activeEmployees = employees.filter(e => e.status === 'Active').length;
    response += `<strong>Employees:</strong><br>`;
    response += `Total: ${employees.length}<br>`;
    response += `Active: ${activeEmployees}<br><br>`;
    
    // Leave stats
    const pendingLeaves = leaves.filter(l => l.status === 'pending').length;
    const approvedLeaves = leaves.filter(l => l.status === 'approved').length;
    const rejectedLeaves = leaves.filter(l => l.status === 'rejected').length;
    
    response += `<strong>Leave Requests:</strong><br>`;
    response += `Pending: ${pendingLeaves}<br>`;
    response += `Approved: ${approvedLeaves}<br>`;
    response += `Rejected: ${rejectedLeaves}<br><br>`;
    
    // Department breakdown
    const depts = {};
    employees.forEach(e => {
        depts[e.department] = (depts[e.department] || 0) + 1;
    });
    
    response += `<strong>By Department:</strong><br>`;
    Object.entries(depts).forEach(([dept, count]) => {
        response += `${dept}: ${count} employees<br>`;
    });
    
    // Total leave balance
    let totalLeave = 0;
    employees.forEach(e => {
        if (e.leaveBalance) {
            totalLeave += e.leaveBalance.paidLeave ?? ((e.leaveBalance.annualLeave || 0) + (e.leaveBalance.sickLeave || 0) + (e.leaveBalance.personalLeave || 0));
        }
    });
    
    response += `<br><strong>Total Paid Leave Balance:</strong> ${totalLeave} days across all employees`;
    
    addMessage(response, 'bot');
}

function handleSearchEmployees(command) {
    // Extract search term
    const searchMatch = command.match(/(?:find|search)\s+(?:employee|staff)\s+(.+)/i);
    
    if (!searchMatch) {
        addMessage("Please specify what to search for. Example: 'search employee in Engineering'", 'bot');
        return;
    }
    
    const searchTerm = searchMatch[1].toLowerCase();
    const employees = getEmployees();
    
    // Smart search across multiple fields
    const results = employees.filter(e => 
        e.firstName.toLowerCase().includes(searchTerm) ||
        e.lastName.toLowerCase().includes(searchTerm) ||
        e.department.toLowerCase().includes(searchTerm) ||
        e.position.toLowerCase().includes(searchTerm) ||
        e.email.toLowerCase().includes(searchTerm)
    );
    
    if (results.length === 0) {
        addMessage(`No employees found matching "${searchTerm}".`, 'bot');
        return;
    }
    
    let response = `<strong>🔍 Found ${results.length} employee(s) matching "${searchTerm}":</strong><br><br>`;
    results.forEach((emp, index) => {
        response += `${index + 1}. <strong>${emp.firstName} ${emp.lastName}</strong><br>`;
        response += `   ${emp.position} - ${emp.department}<br>`;
        response += `   📧 ${emp.email}<br><br>`;
    });
    
    addMessage(response, 'bot');
}

function handleRemoveHoliday(command) {
    const dateMatch = command.match(/(\d{4}-\d{2}-\d{2})/);
    const nameMatch = command.match(/holiday\s+(.+?)(?:\s+on|\s*$)/i);
    
    if (!dateMatch && !nameMatch) {
        addMessage("Please specify the holiday date or name. Example: 'remove holiday on 2026-01-26' or 'remove holiday Christmas'", 'bot');
        return;
    }
    
    const holidays = getHolidays();
    let holidayIndex = -1;
    
    if (dateMatch) {
        holidayIndex = holidays.findIndex(h => h.date === dateMatch[1]);
    } else if (nameMatch) {
        const name = nameMatch[1].toLowerCase();
        holidayIndex = holidays.findIndex(h => h.name.toLowerCase().includes(name));
    }
    
    if (holidayIndex === -1) {
        addMessage("Holiday not found. Please check the date or name and try again.", 'bot');
        return;
    }
    
    const removedHoliday = holidays[holidayIndex];
    holidays.splice(holidayIndex, 1);
    saveHolidays(holidays);
    addLog('delete', `Removed holiday "${removedHoliday.name}" via AI Assistant`);
    
    addMessage(`✅ Holiday "${removedHoliday.name}" on ${removedHoliday.date} has been removed.`, 'bot');
}

function provideSuggestions(command) {
    const lowerCommand = command.toLowerCase();
    let suggestions = [];
    
    // Analyze what user might be trying to do
    if (lowerCommand.includes('leave') && !lowerCommand.includes('add') && !lowerCommand.includes('show')) {
        suggestions = [
            "Try: 'add 2 leave for John'",
            "Try: 'show pending leave requests'",
            "Try: 'approve leave for Jane'"
        ];
    } else if (lowerCommand.includes('employee') && !lowerCommand.includes('show') && !lowerCommand.includes('list')) {
        suggestions = [
            "Try: 'show employee John'",
            "Try: 'list employees'",
            "Try: 'search employee in Engineering'"
        ];
    } else if (lowerCommand.includes('holiday')) {
        suggestions = [
            "Try: 'add holiday on 2026-01-26'",
            "Try: 'remove holiday Christmas'"
        ];
    } else {
        suggestions = [
            "Try: 'show pending leave requests'",
            "Try: 'add 2 leave for John'",
            "Try: 'generate report'",
            "Try: 'help' to see all commands"
        ];
    }
    
    let response = "I didn't quite understand that. Here are some suggestions:<br><br>";
    suggestions.forEach(s => {
        response += `• ${s}<br>`;
    });
    
    addMessage(response, 'bot');
}

function showHelp() {
    const helpText = `
        <strong>🤖 AI Assistant Commands</strong><br><br>
        
        <strong>Leave Management:</strong><br>
        • Add 2 leave for John<br>
        • Give Jane 1.5 sick leave<br>
        • Remove 1 leave from John<br>
        • Approve leave for Jane<br>
        • Reject leave for John<br>
        • Show pending leave requests<br><br>
        
        <strong>Employee Information:</strong><br>
        • Show employee John<br>
        • List employees<br>
        • Search employee in Engineering<br>
        • Show leave balance for Jane<br><br>
        
        <strong>Holidays:</strong><br>
        • Add holiday on 2026-01-26<br>
        • Remove holiday Christmas<br><br>
        
        <strong>Reports:</strong><br>
        • Generate report<br>
        • Show statistics<br><br>
        
        I understand natural language, so feel free to phrase commands in your own way!
    `;
    
    addMessage(helpText, 'bot');
}
