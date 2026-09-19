const validation = require('../../../master-data-validation.js');

describe('Unit: master data validation helpers', () => {
    test('normalizes names and whitespace', () => {
        expect(validation.normalizeName('  Delhi   University  ')).toBe('Delhi University');
    });

    test('validates university input and rejects duplicates', () => {
        const result = validation.validateUniversityInput(
            { name: 'Delhi University', isActive: true },
            {
                existingItems: [
                    { _id: '1', name: 'Mumbai University', isDeleted: false },
                    { _id: '2', name: 'Delhi University', isDeleted: false }
                ]
            }
        );

        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/already exists/i);
    });

    test('course duration must be positive integer', () => {
        const bad = validation.validateCourseInput(
            {
                universityId: 'u1',
                name: 'MBA',
                duration: 1.5,
                totalFees: 100000,
                isActive: true
            },
            { existingItems: [] }
        );

        expect(bad.ok).toBe(false);
        expect(bad.error).toMatch(/positive integer/i);
    });

    test('course total fees must be positive number', () => {
        const bad = validation.validateCourseInput(
            {
                universityId: 'u1',
                name: 'MBA',
                duration: 2,
                totalFees: 0,
                isActive: true
            },
            { existingItems: [] }
        );

        expect(bad.ok).toBe(false);
        expect(bad.error).toMatch(/positive number/i);
    });

    test('same course name is allowed across different universities', () => {
        const good = validation.validateCourseInput(
            {
                universityId: 'u2',
                name: 'MBA',
                duration: 2,
                totalFees: 120000,
                isActive: true
            },
            {
                existingItems: [
                    {
                        _id: '1',
                        universityId: 'u1',
                        name: 'MBA',
                        isDeleted: false
                    }
                ]
            }
        );

        expect(good.ok).toBe(true);
        expect(good.value.duration).toBe(2);
    });
});
