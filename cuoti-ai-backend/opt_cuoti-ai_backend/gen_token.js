const jwt = require('jsonwebtoken');
console.log(jwt.sign({ id: 1, username: 'demo', role: 'student' }, 'cuoti-user-secret-2026-change-me', { expiresIn: '1h' }));
