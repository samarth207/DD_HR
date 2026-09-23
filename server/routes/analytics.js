const express = require('express');
const router = express.Router();
const { getDB, isDBConnected } = require('../db');

const DB_UNAVAILABLE = { error: 'Database not connected', dbUnavailable: true };

// Helper: parse optional date range filters
function buildDateFilter(query) {
    const { month, year, startDate, endDate } = query;
    const filter = {};
    if (startDate && endDate) {
        filter.admissionDate = { $gte: startDate, $lte: endDate };
    } else if (month) {
        filter.month = month; // YYYY-MM
    } else if (year) {
        filter.month = { $regex: `^${year}-` };
    }
    return filter;
}

// GET /api/analytics/admissions
// Employee-wise admission analytics with filters, search, sorting, pagination
router.get('/admissions', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const {
            search, employeeId, department,
            month, year, startDate, endDate,
            sort = 'highest', page = 1, limit = 50
        } = req.query;

        const dateFilter = buildDateFilter({ month, year, startDate, endDate });

        // Build admissions match stage
        const admissionsMatch = { status: 'approved', ...dateFilter };
        if (employeeId) admissionsMatch.employeeId = parseInt(employeeId);

        // Aggregate admissions per employee
        const pipeline = [
            { $match: admissionsMatch },
            {
                $group: {
                    _id: '$employeeId',
                    totalAdmissions: { $sum: 1 },
                    totalRevenue: { $sum: '$revenue' },
                    lastAdmissionDate: { $max: '$admissionDate' },
                    months: { $addToSet: '$month' },
                    admissionDates: { $push: '$admissionDate' }
                }
            }
        ];

        const [admissionsData, employees, allApproved] = await Promise.all([
            db.collection('admissions').aggregate(pipeline).toArray(),
            db.collection('employees').find({}).toArray(),
            db.collection('admissions').find({ status: 'approved' }).toArray()
        ]);

        // Build employee lookup map
        const empMap = {};
        employees.forEach(e => { empMap[e.id] = e; });

        // Build per-employee all-time data for avg/best month
        const allTimeMap = {};
        allApproved.forEach(a => {
            const eid = a.employeeId;
            if (!allTimeMap[eid]) allTimeMap[eid] = { monthCounts: {}, total: 0 };
            allTimeMap[eid].total++;
            const m = a.month || (a.admissionDate ? a.admissionDate.substring(0, 7) : null);
            if (m) allTimeMap[eid].monthCounts[m] = (allTimeMap[eid].monthCounts[m] || 0) + 1;
        });

        const now = new Date();
        const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const lastMonth = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}`;
        const thisYear = String(now.getFullYear());

        // Build analytics per employee
        let results = admissionsData.map(row => {
            const emp = empMap[row._id] || {};
            const fullName = `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || `Employee ${row._id}`;
            const dept = emp.department || 'Unknown';
            const atData = allTimeMap[row._id] || { monthCounts: {}, total: 0 };

            const monthCounts = atData.monthCounts;
            const totalAllTime = atData.total;
            const numMonths = Object.keys(monthCounts).length || 1;
            const avgPerMonth = totalAllTime / numMonths;

            // Best performing month
            let bestMonth = null, bestCount = 0;
            Object.entries(monthCounts).forEach(([m, c]) => {
                if (c > bestCount) { bestCount = c; bestMonth = m; }
            });

            // Current filter period counts
            const admissionsThisMonth = monthCounts[thisMonth] || 0;
            const admissionsLastMonth = monthCounts[lastMonth] || 0;
            const admissionsThisYear = Object.entries(monthCounts)
                .filter(([m]) => m.startsWith(thisYear))
                .reduce((s, [, c]) => s + c, 0);

            return {
                employeeId: row._id,
                employeeName: fullName,
                department: dept,
                totalAdmissions: row.totalAdmissions,
                admissionsThisMonth,
                admissionsLastMonth,
                admissionsThisYear,
                totalRevenue: Math.round(row.totalRevenue * 100) / 100,
                avgPerMonth: Math.round(avgPerMonth * 10) / 10,
                bestMonth,
                lastAdmissionDate: row.lastAdmissionDate
            };
        });

        // Apply search filter
        if (search) {
            const q = search.toLowerCase();
            results = results.filter(r =>
                r.employeeName.toLowerCase().includes(q) ||
                String(r.employeeId).includes(q)
            );
        }

        // Apply department filter
        if (department) {
            results = results.filter(r => r.department === department);
        }

        // Apply sorting
        const sortMap = {
            highest: (a, b) => b.totalAdmissions - a.totalAdmissions,
            lowest:  (a, b) => a.totalAdmissions - b.totalAdmissions,
            revenue: (a, b) => b.totalRevenue - a.totalRevenue,
            newest:  (a, b) => (b.lastAdmissionDate || '').localeCompare(a.lastAdmissionDate || ''),
            oldest:  (a, b) => (a.lastAdmissionDate || '').localeCompare(b.lastAdmissionDate || '')
        };
        results.sort(sortMap[sort] || sortMap.highest);

        // Pagination
        const total = results.length;
        const pageNum = Math.max(1, parseInt(page));
        const pageSize = Math.min(200, Math.max(1, parseInt(limit)));
        const paginated = results.slice((pageNum - 1) * pageSize, pageNum * pageSize);

        res.json({ data: paginated, total, page: pageNum, limit: pageSize });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/analytics/charts
// Data for all 5 charts, respecting filters
router.get('/charts', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const { year, employeeId, department, startDate, endDate, groupBy = 'monthly' } = req.query;

        const now = new Date();
        const targetYear = year || String(now.getFullYear());

        const approvedFilter = { status: 'approved' };
        if (employeeId) approvedFilter.employeeId = parseInt(employeeId);

        const allApproved = await db.collection('admissions').find(approvedFilter).toArray();
        const employees = await db.collection('employees').find({}).toArray();
        const empMap = {};
        employees.forEach(e => { empMap[e.id] = e; });

        // Filter by department if set
        let filtered = allApproved;
        if (department) {
            filtered = allApproved.filter(a => {
                const emp = empMap[a.employeeId];
                return emp && emp.department === department;
            });
        }
        if (startDate && endDate) {
            filtered = filtered.filter(a => a.admissionDate >= startDate && a.admissionDate <= endDate);
        }

        // Chart 1: Month-wise bar chart (for target year)
        const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const monthWise = Array(12).fill(0);
        filtered.forEach(a => {
            if (a.month && a.month.startsWith(targetYear)) {
                const mIdx = parseInt(a.month.split('-')[1]) - 1;
                if (mIdx >= 0 && mIdx < 12) monthWise[mIdx]++;
            }
        });

        // Chart 2: Employee-wise horizontal bar
        const empCounts = {};
        filtered.forEach(a => {
            const eid = a.employeeId;
            if (!empCounts[eid]) {
                const emp = empMap[eid];
                empCounts[eid] = {
                    name: emp ? `${emp.firstName || ''} ${emp.lastName || ''}`.trim() : `Emp ${eid}`,
                    count: 0,
                    revenue: 0
                };
            }
            empCounts[eid].count++;
            empCounts[eid].revenue += parseFloat(a.revenue) || 0;
        });
        const empWise = Object.values(empCounts).sort((a, b) => b.count - a.count).slice(0, 20);

        // Chart 3: Monthly company growth (line chart)
        const growthMap = {};
        filtered.forEach(a => {
            const m = a.month || (a.admissionDate ? a.admissionDate.substring(0, 7) : null);
            if (!m) return;
            if (!growthMap[m]) growthMap[m] = { admissions: 0, revenue: 0 };
            growthMap[m].admissions++;
            growthMap[m].revenue += parseFloat(a.revenue) || 0;
        });

        let growthData;
        if (groupBy === 'quarterly') {
            const qMap = {};
            Object.entries(growthMap).forEach(([m, v]) => {
                const [yr, mo] = m.split('-');
                const q = `${yr}-Q${Math.ceil(parseInt(mo) / 3)}`;
                if (!qMap[q]) qMap[q] = { admissions: 0, revenue: 0 };
                qMap[q].admissions += v.admissions;
                qMap[q].revenue += v.revenue;
            });
            growthData = Object.entries(qMap).sort(([a], [b]) => a.localeCompare(b)).map(([label, v]) => ({ label, ...v }));
        } else if (groupBy === 'yearly') {
            const yrMap = {};
            Object.entries(growthMap).forEach(([m, v]) => {
                const yr = m.split('-')[0];
                if (!yrMap[yr]) yrMap[yr] = { admissions: 0, revenue: 0 };
                yrMap[yr].admissions += v.admissions;
                yrMap[yr].revenue += v.revenue;
            });
            growthData = Object.entries(yrMap).sort(([a], [b]) => a.localeCompare(b)).map(([label, v]) => ({ label, ...v }));
        } else {
            growthData = Object.entries(growthMap).sort(([a], [b]) => a.localeCompare(b)).map(([label, v]) => ({ label, ...v }));
        }

        // Chart 4: Top performers pie/doughnut
        const topPerformers = empWise.slice(0, 8);

        // Chart 5: Trend (area chart) - monthly over time sorted
        const trendData = Object.entries(growthMap)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([label, v]) => ({ label, admissions: v.admissions, revenue: v.revenue }));

        res.json({
            monthWise: { labels: MONTHS, data: monthWise },
            empWise: { labels: empWise.map(e => e.name), data: empWise.map(e => e.count), revenue: empWise.map(e => e.revenue) },
            growth: growthData,
            topPerformers: { labels: topPerformers.map(e => e.name), data: topPerformers.map(e => e.count) },
            trend: trendData
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/analytics/company
// Overall company KPI stats with optional filters and YoY comparison
router.get('/company', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const { month, year, employeeId, department, university, course, startDate, endDate, yoy = false } = req.query;
        const now = new Date();
        const today = now.toISOString().substring(0, 10);
        const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const lastMonth = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}`;

        // Build date filter
        const dateFilter = buildDateFilter({ month, year, startDate, endDate });

        // Build base admissions filter
        const admissionsFilter = { status: 'approved', ...dateFilter };
        if (employeeId) admissionsFilter.employeeId = parseInt(employeeId);
        if (university) admissionsFilter.universityName = university;
        if (course) admissionsFilter.course = course;

        // Build YoY comparison filter (same period last year)
        let yoyFilter = null;
        if (yoy === 'true') {
            if (month) {
                const [mYear, mMonth] = month.split('-');
                const lastYearMonth = `${parseInt(mYear) - 1}-${mMonth}`;
                yoyFilter = { status: 'approved', month: lastYearMonth };
                if (employeeId) yoyFilter.employeeId = parseInt(employeeId);
                if (university) yoyFilter.universityName = university;
                if (course) yoyFilter.course = course;
            } else if (year) {
                const lastYear = String(parseInt(year) - 1);
                yoyFilter = { status: 'approved', month: { $regex: `^${lastYear}-` } };
                if (employeeId) yoyFilter.employeeId = parseInt(employeeId);
                if (university) yoyFilter.universityName = university;
                if (course) yoyFilter.course = course;
            } else if (startDate && endDate) {
                const start = new Date(startDate);
                const end = new Date(endDate);
                const daysDiff = Math.floor((end - start) / (1000 * 60 * 60 * 24));
                const lastYearStart = new Date(start);
                lastYearStart.setFullYear(start.getFullYear() - 1);
                const lastYearEnd = new Date(lastYearStart);
                lastYearEnd.setDate(lastYearStart.getDate() + daysDiff);
                yoyFilter = { 
                    status: 'approved',
                    admissionDate: { $gte: lastYearStart.toISOString().substring(0, 10), $lte: lastYearEnd.toISOString().substring(0, 10) }
                };
                if (employeeId) yoyFilter.employeeId = parseInt(employeeId);
                if (university) yoyFilter.universityName = university;
                if (course) yoyFilter.course = course;
            } else {
                // Default: compare this month to same month last year
                const lastYearMonth = `${now.getFullYear() - 1}-${String(now.getMonth() + 1).padStart(2, '0')}`;
                yoyFilter = { status: 'approved', month: lastYearMonth };
                if (employeeId) yoyFilter.employeeId = parseInt(employeeId);
                if (university) yoyFilter.universityName = university;
                if (course) yoyFilter.course = course;
            }
        }

        const [
            allEmployees,
            allApproved,
            pendingAdmissions,
            rejectedAdmissions,
            yoyApproved
        ] = await Promise.all([
            db.collection('employees').find({}).toArray(),
            db.collection('admissions').find(admissionsFilter).toArray(),
            db.collection('admissions').countDocuments({ status: 'pending', ...dateFilter }),
            db.collection('admissions').countDocuments({ status: 'rejected', ...dateFilter }),
            yoyFilter ? db.collection('admissions').find(yoyFilter).toArray() : Promise.resolve([])
        ]);

        // Build employee lookup map
        const empMap = {};
        allEmployees.forEach(e => { empMap[e.id] = e; });

        // Filter by department if set
        let filteredApproved = allApproved;
        let filteredYoy = yoyApproved;
        if (department) {
            filteredApproved = allApproved.filter(a => {
                const emp = empMap[a.employeeId];
                return emp && emp.department === department;
            });
            filteredYoy = yoyApproved.filter(a => {
                const emp = empMap[a.employeeId];
                return emp && emp.department === department;
            });
        }

        const totalEmployees = allEmployees.length;
        const totalAdmissions = filteredApproved.length;
        const totalRevenue = filteredApproved.reduce((s, a) => s + (parseFloat(a.revenue) || 0), 0);

        // YoY comparison data
        const yoyTotalAdmissions = filteredYoy.length;
        const yoyTotalRevenue = filteredYoy.reduce((s, a) => s + (parseFloat(a.revenue) || 0), 0);
        const yoyGrowth = yoyTotalAdmissions > 0 
            ? Math.round(((totalAdmissions - yoyTotalAdmissions) / yoyTotalAdmissions) * 100) 
            : totalAdmissions > 0 ? 100 : 0;

        const thisMonthAdmissions = filteredApproved.filter(a => a.month === thisMonth);
        const lastMonthAdmissions = filteredApproved.filter(a => a.month === lastMonth);
        const todayAdmissions = filteredApproved.filter(a => a.admissionDate === today);

        const countThisMonth = thisMonthAdmissions.length;
        const countLastMonth = lastMonthAdmissions.length;
        const revenueThisMonth = thisMonthAdmissions.reduce((s, a) => s + (parseFloat(a.revenue) || 0), 0);

        // Growth
        const growth = countLastMonth > 0
            ? Math.round(((countThisMonth - countLastMonth) / countLastMonth) * 100)
            : countThisMonth > 0 ? 100 : 0;

        // Per-employee stats (using filtered data)
        const empCounts = {};
        filteredApproved.forEach(a => {
            const eid = a.employeeId;
            if (!empCounts[eid]) empCounts[eid] = { count: 0, thisMonth: 0 };
            empCounts[eid].count++;
            if (a.month === thisMonth) empCounts[eid].thisMonth++;
        });

        let bestEmpId = null, bestCount = 0, lowestEmpId = null, lowestCount = Infinity;
        Object.entries(empCounts).forEach(([eid, v]) => {
            if (v.thisMonth > bestCount) { bestCount = v.thisMonth; bestEmpId = eid; }
            if (v.thisMonth < lowestCount) { lowestCount = v.thisMonth; lowestEmpId = eid; }
        });

        const getEmpName = (id) => {
            if (!id) return 'N/A';
            const emp = empMap[parseInt(id)];
            return emp ? `${emp.firstName || ''} ${emp.lastName || ''}`.trim() : `Emp ${id}`;
        };

        const avgPerEmployee = totalEmployees > 0
            ? Math.round((countThisMonth / totalEmployees) * 10) / 10 : 0;

        // Monthly target (from sales aggregate)
        const salesAgg = await db.collection('sales').find({ month: thisMonth }).toArray();
        const totalTarget = salesAgg.reduce((s, r) => s + (r.salesTarget || 0), 0);
        const targetCompletion = totalTarget > 0
            ? Math.round((countThisMonth / totalTarget) * 100) : null;

        // Overall performance score (0-100): weighted metric
        const performanceScore = Math.min(100, Math.max(0,
            (totalAdmissions > 0 ? 30 : 0) +
            (growth > 0 ? Math.min(30, growth) : 0) +
            (targetCompletion !== null ? Math.min(40, targetCompletion * 0.4) : 20)
        ));

        // Months with data for average
        const monthSet = new Set(allApproved.map(a => a.month).filter(Boolean));
        const numMonths = monthSet.size || 1;

        res.json({
            totalEmployees,
            totalAdmissions,
            admissionsThisMonth: countThisMonth,
            admissionsLastMonth: countLastMonth,
            admissionsToday: todayAdmissions.length,
            pendingAdmissions,
            completedAdmissions: totalAdmissions,
            cancelledAdmissions: rejectedAdmissions,
            totalRevenue: Math.round(totalRevenue * 100) / 100,
            revenueThisMonth: Math.round(revenueThisMonth * 100) / 100,
            avgPerEmployee,
            avgPerMonthCompany: Math.round((totalAdmissions / numMonths) * 10) / 10,
            bestEmployee: getEmpName(bestEmpId),
            bestEmployeeCount: bestCount,
            lowestEmployee: getEmpName(lowestEmpId),
            lowestEmployeeCount: lowestCount === Infinity ? 0 : lowestCount,
            growth,
            growthDirection: growth > 0 ? 'up' : growth < 0 ? 'down' : 'flat',
            targetCompletion,
            performanceScore: Math.round(performanceScore),
            // YoY comparison data
            yoy: {
                totalAdmissions: yoyTotalAdmissions,
                totalRevenue: Math.round(yoyTotalRevenue * 100) / 100,
                growth: yoyGrowth,
                growthDirection: yoyGrowth > 0 ? 'up' : yoyGrowth < 0 ? 'down' : 'flat'
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/analytics/insights
// Auto-generated insights with optional filters
router.get('/insights', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const { month, year, employeeId, department, startDate, endDate } = req.query;
        const now = new Date();
        const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const lastMonth = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}`;
        const twoMonthsAgoDate = new Date(now.getFullYear(), now.getMonth() - 2, 1);
        const twoMonthsAgo = `${twoMonthsAgoDate.getFullYear()}-${String(twoMonthsAgoDate.getMonth() + 1).padStart(2, '0')}`;

        // Build date filter
        const dateFilter = buildDateFilter({ month, year, startDate, endDate });

        // Build base admissions filter
        const admissionsFilter = { status: 'approved', ...dateFilter };
        if (employeeId) admissionsFilter.employeeId = parseInt(employeeId);

        const allApproved = await db.collection('admissions').find(admissionsFilter).toArray();
        const employees = await db.collection('employees').find({}).toArray();
        const empMap = {};
        employees.forEach(e => { empMap[e.id] = e; });

        // Filter by department if set
        let filteredApproved = allApproved;
        if (department) {
            filteredApproved = allApproved.filter(a => {
                const emp = empMap[a.employeeId];
                return emp && emp.department === department;
            });
        }

        const countByMonth = {};
        const empCountThisMonth = {};
        filteredApproved.forEach(a => {
            const m = a.month || (a.admissionDate ? a.admissionDate.substring(0, 7) : null);
            if (m) countByMonth[m] = (countByMonth[m] || 0) + 1;
            if (m === thisMonth) {
                empCountThisMonth[a.employeeId] = (empCountThisMonth[a.employeeId] || 0) + 1;
            }
        });

        const cTM = countByMonth[thisMonth] || 0;
        const cLM = countByMonth[lastMonth] || 0;
        const cTMA = countByMonth[twoMonthsAgo] || 0;

        const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
        const thisMonthName = MONTH_NAMES[now.getMonth()];
        const lastMonthName = MONTH_NAMES[lastMonthDate.getMonth()];
        const twoMonthsAgoName = MONTH_NAMES[twoMonthsAgoDate.getMonth()];

        const insights = [];

        // Growth vs last month
        if (cLM > 0) {
            const pct = Math.round(((cTM - cLM) / cLM) * 100);
            if (pct > 0) {
                insights.push({ icon: '📈', type: 'positive', text: `Admissions increased by ${pct}% compared to last month.` });
            } else if (pct < 0) {
                insights.push({ icon: '📉', type: 'warning', text: `Admissions decreased by ${Math.abs(pct)}% compared to last month.` });
            } else {
                insights.push({ icon: '📊', type: 'neutral', text: `Admissions remained the same as last month (${cTM}).` });
            }
        } else if (cTM > 0) {
            insights.push({ icon: '🚀', type: 'positive', text: `${cTM} admissions recorded this month — great start!` });
        }

        // Top performer this month
        let topEmpId = null, topCount = 0;
        Object.entries(empCountThisMonth).forEach(([eid, c]) => {
            if (c > topCount) { topCount = c; topEmpId = eid; }
        });
        if (topEmpId) {
            const emp = empMap[parseInt(topEmpId)];
            const name = emp ? `${emp.firstName || ''} ${emp.lastName || ''}`.trim() : `Employee ${topEmpId}`;
            insights.push({ icon: '🏆', type: 'positive', text: `${name} completed the highest admissions this month (${topCount}).` });
        }

        // Consecutive decline
        if (cTM < cLM && cLM < cTMA && cTMA > 0) {
            insights.push({ icon: '⚠', type: 'danger', text: `Admissions have declined for two consecutive months (${twoMonthsAgoName}: ${cTMA} → ${lastMonthName}: ${cLM} → ${thisMonthName}: ${cTM}). Recommend reviewing lead conversion strategies.` });
        } else if (cTM < cLM) {
            insights.push({ icon: '💡', type: 'info', text: `Admissions decreased in ${thisMonthName}. Consider focusing on lead conversion to improve numbers.` });
        }

        // Target completion
        const salesAgg = await db.collection('sales').find({ month: thisMonth }).toArray();
        const totalTarget = salesAgg.reduce((s, r) => s + (r.salesTarget || 0), 0);
        if (totalTarget > 0) {
            const pct = Math.round((cTM / totalTarget) * 100);
            insights.push({ icon: '🎯', type: pct >= 90 ? 'positive' : pct >= 70 ? 'neutral' : 'warning', text: `Company achieved ${pct}% of the monthly target (${cTM}/${totalTarget}).` });
        }

        // Revenue insight
        const revThisMonth = filteredApproved
            .filter(a => a.month === thisMonth)
            .reduce((s, a) => s + (parseFloat(a.revenue) || 0), 0);
        if (revThisMonth > 0) {
            insights.push({ icon: '💰', type: 'positive', text: `Total revenue generated this month: ₹${revThisMonth.toLocaleString('en-IN')}.` });
        }

        // New employees with no admissions
        const empIds = new Set(allApproved.map(a => a.employeeId));
        const inactive = employees.filter(e => !empIds.has(e.id));
        if (inactive.length > 0) {
            insights.push({ icon: '👤', type: 'info', text: `${inactive.length} employee(s) have no recorded admissions yet.` });
        }

        res.json({ insights });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/analytics/departments
// Departments list for filter dropdown
router.get('/departments', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const depts = await db.collection('employees').distinct('department');
        res.json({ departments: depts.filter(Boolean).sort() });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/analytics/universities
// University-wise admission analytics
router.get('/universities', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const { month, year, employeeId, department, startDate, endDate } = req.query;
        
        const dateFilter = buildDateFilter({ month, year, startDate, endDate });
        const admissionsFilter = { status: 'approved', ...dateFilter };
        if (employeeId) admissionsFilter.employeeId = parseInt(employeeId);
        
        const admissions = await db.collection('admissions').find(admissionsFilter).toArray();
        const employees = await db.collection('employees').find({}).toArray();
        const empMap = {};
        employees.forEach(e => { empMap[e.id] = e; });
        
        // Filter by department if set
        let filtered = admissions;
        if (department) {
            filtered = admissions.filter(a => {
                const emp = empMap[a.employeeId];
                return emp && emp.department === department;
            });
        }
        
        // Aggregate by university
        const universityStats = {};
        filtered.forEach(a => {
            const uni = a.universityName || 'Unknown';
            if (!universityStats[uni]) {
                universityStats[uni] = {
                    university: uni,
                    admissions: 0,
                    revenue: 0,
                    courses: new Set()
                };
            }
            universityStats[uni].admissions++;
            universityStats[uni].revenue += parseFloat(a.revenue) || 0;
            if (a.course) universityStats[uni].courses.add(a.course);
        });
        
        const result = Object.values(universityStats).map(u => ({
            university: u.university,
            admissions: u.admissions,
            revenue: Math.round(u.revenue * 100) / 100,
            revenuePerAdmission: u.admissions > 0 ? Math.round((u.revenue / u.admissions) * 100) / 100 : 0,
            uniqueCourses: u.courses.size
        })).sort((a, b) => b.admissions - a.admissions);
        
        res.json({ universities: result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/analytics/courses
// Course-wise admission analytics
router.get('/courses', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const { month, year, employeeId, department, startDate, endDate } = req.query;
        
        const dateFilter = buildDateFilter({ month, year, startDate, endDate });
        const admissionsFilter = { status: 'approved', ...dateFilter };
        if (employeeId) admissionsFilter.employeeId = parseInt(employeeId);
        
        const admissions = await db.collection('admissions').find(admissionsFilter).toArray();
        const employees = await db.collection('employees').find({}).toArray();
        const empMap = {};
        employees.forEach(e => { empMap[e.id] = e; });
        
        // Filter by department if set
        let filtered = admissions;
        if (department) {
            filtered = admissions.filter(a => {
                const emp = empMap[a.employeeId];
                return emp && emp.department === department;
            });
        }
        
        // Aggregate by course
        const courseStats = {};
        filtered.forEach(a => {
            const course = a.course || 'Unknown';
            if (!courseStats[course]) {
                courseStats[course] = {
                    course: course,
                    admissions: 0,
                    revenue: 0,
                    universities: new Set()
                };
            }
            courseStats[course].admissions++;
            courseStats[course].revenue += parseFloat(a.revenue) || 0;
            if (a.universityName) courseStats[course].universities.add(a.universityName);
        });
        
        const result = Object.values(courseStats).map(c => ({
            course: c.course,
            admissions: c.admissions,
            revenue: Math.round(c.revenue * 100) / 100,
            revenuePerAdmission: c.admissions > 0 ? Math.round((c.revenue / c.admissions) * 100) / 100 : 0,
            uniqueUniversities: c.universities.size
        })).sort((a, b) => b.admissions - a.admissions);
        
        res.json({ courses: result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/analytics/leaderboard
// Employee performance leaderboard with rankings
router.get('/leaderboard', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const { month, year, department, startDate, endDate } = req.query;
        
        const dateFilter = buildDateFilter({ month, year, startDate, endDate });
        const admissionsFilter = { status: 'approved', ...dateFilter };
        
        const admissions = await db.collection('admissions').find(admissionsFilter).toArray();
        const employees = await db.collection('employees').find({}).toArray();
        const empMap = {};
        employees.forEach(e => { empMap[e.id] = e; });
        
        // Filter by department if set
        let filtered = admissions;
        if (department) {
            filtered = admissions.filter(a => {
                const emp = empMap[a.employeeId];
                return emp && emp.department === department;
            });
        }
        
        // Aggregate by employee
        const empStats = {};
        filtered.forEach(a => {
            const eid = a.employeeId;
            if (!empStats[eid]) {
                empStats[eid] = {
                    employeeId: eid,
                    admissions: 0,
                    revenue: 0,
                    universities: new Set(),
                    courses: new Set()
                };
            }
            empStats[eid].admissions++;
            empStats[eid].revenue += parseFloat(a.revenue) || 0;
            if (a.universityName) empStats[eid].universities.add(a.universityName);
            if (a.course) empStats[eid].courses.add(a.course);
        });
        
        // Add employee details and calculate metrics
        const leaderboard = Object.values(empStats).map(e => {
            const emp = empMap[e.employeeId];
            return {
                employeeId: e.employeeId,
                name: emp ? `${emp.firstName || ''} ${emp.lastName || ''}`.trim() : `Emp ${e.employeeId}`,
                department: emp ? emp.department : 'Unknown',
                admissions: e.admissions,
                revenue: Math.round(e.revenue * 100) / 100,
                revenuePerAdmission: e.admissions > 0 ? Math.round((e.revenue / e.admissions) * 100) / 100 : 0,
                uniqueUniversities: e.universities.size,
                uniqueCourses: e.courses.size
            };
        }).sort((a, b) => b.admissions - a.admissions);
        
        // Add rankings
        leaderboard.forEach((entry, index) => {
            entry.rank = index + 1;
        });
        
        // Calculate top performer metrics
        const topPerformer = leaderboard.length > 0 ? leaderboard[0] : null;
        const avgAdmissions = leaderboard.length > 0 
            ? Math.round(leaderboard.reduce((sum, e) => sum + e.admissions, 0) / leaderboard.length * 10) / 10 
            : 0;
        
        res.json({ 
            leaderboard: leaderboard.slice(0, 20), // Top 20
            topPerformer,
            avgAdmissions,
            totalEmployees: leaderboard.length
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/analytics/revenue
// Enhanced revenue analytics with distribution and trends
router.get('/revenue', async (req, res) => {
    if (!isDBConnected()) return res.status(503).json(DB_UNAVAILABLE);
    try {
        const db = getDB();
        const { month, year, employeeId, department, startDate, endDate } = req.query;
        
        const dateFilter = buildDateFilter({ month, year, startDate, endDate });
        const admissionsFilter = { status: 'approved', ...dateFilter };
        if (employeeId) admissionsFilter.employeeId = parseInt(employeeId);
        
        const admissions = await db.collection('admissions').find(admissionsFilter).toArray();
        const employees = await db.collection('employees').find({}).toArray();
        const empMap = {};
        employees.forEach(e => { empMap[e.id] = e; });
        
        // Filter by department if set
        let filtered = admissions;
        if (department) {
            filtered = admissions.filter(a => {
                const emp = empMap[a.employeeId];
                return emp && emp.department === department;
            });
        }
        
        // Calculate revenue metrics
        const totalRevenue = filtered.reduce((sum, a) => sum + (parseFloat(a.revenue) || 0), 0);
        const avgRevenue = filtered.length > 0 ? totalRevenue / filtered.length : 0;
        
        // Revenue distribution by ranges
        const distribution = {
            low: 0,      // < 10,000
            medium: 0,   // 10,000 - 50,000
            high: 0,     // 50,000 - 100,000
            premium: 0   // > 100,000
        };
        
        filtered.forEach(a => {
            const rev = parseFloat(a.revenue) || 0;
            if (rev < 10000) distribution.low++;
            else if (rev < 50000) distribution.medium++;
            else if (rev < 100000) distribution.high++;
            else distribution.premium++;
        });
        
        // Top revenue admissions
        const topRevenueAdmissions = filtered
            .map(a => ({
                id: a.id,
                studentName: a.customerName || 'Unknown',
                university: a.universityName || 'Unknown',
                course: a.course || 'Unknown',
                revenue: parseFloat(a.revenue) || 0,
                employeeId: a.employeeId,
                employeeName: empMap[a.employeeId] ? `${empMap[a.employeeId].firstName || ''} ${empMap[a.employeeId].lastName || ''}`.trim() : 'Unknown'
            }))
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 10);
        
        // Revenue by month (for trend)
        const revenueByMonth = {};
        filtered.forEach(a => {
            if (a.month) {
                if (!revenueByMonth[a.month]) revenueByMonth[a.month] = 0;
                revenueByMonth[a.month] += parseFloat(a.revenue) || 0;
            }
        });
        
        const monthlyRevenue = Object.entries(revenueByMonth)
            .map(([month, revenue]) => ({ month, revenue: Math.round(revenue * 100) / 100 }))
            .sort((a, b) => a.month.localeCompare(b.month));
        
        res.json({
            totalRevenue: Math.round(totalRevenue * 100) / 100,
            avgRevenue: Math.round(avgRevenue * 100) / 100,
            distribution,
            topRevenueAdmissions,
            monthlyRevenue,
            totalAdmissions: filtered.length
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
