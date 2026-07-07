const mongoose = require('mongoose');
require('dotenv').config({ path: 'e:\\merasoftware-new\\backend\\.env' });

const userSchema = new mongoose.Schema({
    name: String,
    email: {
        type: String,
        required: true,
        unique: true,
    },
    password: String,
    roles: {
        type: [String],
        required: true,
        default: []
    }
});

const User = mongoose.model('user', userSchema);

async function verifyAdmin() {
    try {
        console.log('📡 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log('✅ Connected\n');

        const adminUser = await User.findOne({ email: 'admin@merasoftware.com' });

        if (!adminUser) {
            console.log('❌ Admin user not found');
            process.exit(1);
        }

        console.log('📋 ADMIN USER DATA:');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('Email:', adminUser.email);
        console.log('Name:', adminUser.name);
        console.log('Roles Array:', JSON.stringify(adminUser.roles, null, 2));
        console.log('Role Count:', adminUser.roles.length);
        console.log('Has Admin?', adminUser.roles.includes('admin'));
        console.log('Has Customer?', adminUser.roles.includes('customer'));
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        // Check other users too
        const allUsers = await User.find({}).select('email roles');
        console.log('📊 ALL USERS ROLES:');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        allUsers.forEach(user => {
            console.log(`${user.email}: ${JSON.stringify(user.roles)}`);
        });
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

        await mongoose.connection.close();
        process.exit(0);

    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

verifyAdmin();
