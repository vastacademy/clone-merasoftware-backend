const mongoose = require('mongoose')

const developerSchema = new mongoose.Schema({
    // Basic Information
    name: {
      type: String,
      required: true,
      trim: true
    },
    email: {
      type: String,
      unique: true,
      required : true
  },
    phone: {
      type: String,
      validate: {
        validator: function(v) {
          return /\d{10}/.test(v);
        },
        message: props => `${props.value} is not a valid phone number!`
      }
    },
  
    designation: {
      type: String,
      required: true,
      enum: ['Junior Developer', 'Senior Developer', 'Team Lead', 'Project Manager'],
      default: 'Junior Developer'
    },
    department: {
      type: String,
      required: true,
      enum: ['Frontend', 'Backend', 'Full Stack', 'Mobile Development']
    },
    employeeId: {
      type: String,
      required: true,
    },
  
    expertise: [{
      skillName: String,
      level: {
        type: String,
        enum: ['Beginner', 'Intermediate', 'Expert']
      },
      yearsOfExperience: Number
    }],
    experience: {
      totalYears: Number,
      previousCompanies: [{
        companyName: String,
        position: String,
        duration: String
      }]
    },
  
    status: {
      type: String,
      enum: ['Available', 'Working', 'On Leave', 'Training'],
      default: 'Available'
    },
    workload: {
      maxProjects: {
        type: Number,
        default: 3
      },
      maxUpdatesPerDay: {
        type: Number,
        default: 2
      }
    },
    availability: {
      timeZone: String,
      workingHours: {
        start: String,
        end: String
      },
      leaves: [{
        from: Date,
        to: Date,
        reason: String,
        type: {
          type: String,
          enum: ['Sick', 'Vacation', 'Personal']
        }
      }]
    },
  
    activeProjects: [{
      project: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Project'
      },
      assignedDate: {
        type: Date,
        default: Date.now
      },
      role: String
    }],
    completedProjects: [{
      project: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Project'
      },
      completionDate: Date,
      clientFeedback: String,
      rating: Number
    }],
  
    currentUpdates: [{
      updatePlan: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'WebsiteUpdatePlan'
      },
      clientId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      startDate: Date,
      nextUpdateDue: Date
    }],
  
    performance: {
      ratings: [{
        score: Number,
        projectId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Project'
        },
        feedback: String,
        date: {
          type: Date,
          default: Date.now
        }
      }],
      averageRating: {
        type: Number,
        default: 0
      },
      successRate: {
        type: Number,
        default: 100
      },
      projectsDeliveredOnTime: {
        type: Number,
        default: 0
      },
      clientSatisfactionScore: {
        type: Number,
        default: 0
      }
    },
  
    notifications: [{
      message: String,
      type: {
        type: String,
        enum: ['Project', 'Update', 'System', 'Admin']
      },
      read: {
        type: Boolean,
        default: false
      },
      createdAt: {
        type: Date,
        default: Date.now
      }
    }],
    
    avatar: String,
    isActive: {
      type: Boolean,
      default: true
    },
    lastActive: Date,
    systemAccess: {
      role: {
        type: String,
        enum: ['developer', 'admin'],
        default: 'developer'
      },
      permissions: [String]
    },
    accountCreated: {
      type: Date,
      default: Date.now
    }
  }, {
    timestamps: true
  });
  
  // Developer schema को complete करते हैं
developerSchema.methods = {
    // नया प्रोजेक्ट assign करने का method
    async assignProject(projectId, projectDetails) {
      try {
        // Initialize activeProjects if it doesn't exist
    if (!this.activeProjects) {
      this.activeProjects = [];
    }
        // Check if developer can take more projects
        if (this.activeProjects.length >= this.workload.maxProjects) {
          throw new Error('Developer has reached maximum project capacity');
        }
  
        // Add project to active projects
        this.activeProjects.push({
          project: projectId,
          assignedDate: new Date(),
          role: projectDetails.role || 'Developer'
        });
  
        // Update developer status
        this.status = 'Working';
        this.lastActive = new Date();
  
        // Add notification for new project
        this.notifications.push({
          message: `New project assigned: ${projectDetails.projectName}`,
          type: 'Project',
          createdAt: new Date()
        });
  
        await this.save();
        return true;
      } catch (error) {
        throw new Error(`Project assignment failed: ${error.message}`);
      }
    },
  
    // प्रोजेक्ट complete करने का method
    async completeProject(projectId, feedbackData) {
      try {
        // Find project in active projects
        const projectIndex = this.activeProjects.findIndex(p => 
          p.project.toString() === projectId.toString()
        );
  
        if (projectIndex === -1) {
          throw new Error('Project not found in active projects');
        }
  
        const project = this.activeProjects[projectIndex];
  
        // Move project to completed projects
        this.completedProjects.push({
          project: projectId,
          completionDate: new Date(),
          clientFeedback: feedbackData.feedback,
          rating: feedbackData.rating
        });
  
        // Remove from active projects
        this.activeProjects.splice(projectIndex, 1);
  
        // Update performance metrics
        await this.updatePerformanceMetrics();
  
        // Add completion notification
        this.notifications.push({
          message: 'Project completed successfully',
          type: 'Project',
          createdAt: new Date()
        });
  
        await this.save();
        return true;
      } catch (error) {
        throw new Error(`Project completion failed: ${error.message}`);
      }
    },
  
    // Update service के लिए method
    async assignUpdateTask(updatePlanId, clientId) {
      try {
        // Check if developer can take more updates
        const activeUpdates = this.currentUpdates.filter(u => 
          !u.nextUpdateDue || u.nextUpdateDue > new Date()
        );
  
        if (activeUpdates.length >= this.workload.maxUpdatesPerDay) {
          throw new Error('Developer has reached maximum updates capacity');
        }
  
        // Add update task
        this.currentUpdates.push({
          updatePlan: updatePlanId,
          clientId: clientId,
          startDate: new Date(),
          nextUpdateDue: new Date(Date.now() + 24 * 60 * 60 * 1000) // Next day
        });
  
        await this.save();
        return true;
      } catch (error) {
        throw new Error(`Update task assignment failed: ${error.message}`);
      }
    },
  
    // Performance metrics update का method
    async updatePerformanceMetrics() {
      try {
        // Calculate average rating
        if (this.performance.ratings.length > 0) {
          const totalScore = this.performance.ratings.reduce((sum, rating) => 
            sum + rating.score, 0
          );
          this.performance.averageRating = totalScore / this.performance.ratings.length;
        }
  
        // Calculate success rate
        const totalProjects = this.completedProjects.length;
        const successfulProjects = this.completedProjects.filter(p => p.rating >= 4).length;
        this.performance.successRate = (successfulProjects / totalProjects) * 100;
  
        // Calculate on-time delivery rate
        this.performance.projectsDeliveredOnTime = this.completedProjects.filter(p => {
          // Add your on-time delivery logic here
          return true; // Placeholder
        }).length;
  
        await this.save();
      } catch (error) {
        throw new Error(`Performance metrics update failed: ${error.message}`);
      }
    },
  
    // Availability check का method
    async checkAvailability() {
      try {
        // Check if developer is on leave
        const currentDate = new Date();
        const onLeave = this.availability.leaves.some(leave => 
          currentDate >= leave.from && currentDate <= leave.to
        );
  
        if (onLeave) {
          return {
            available: false,
            reason: 'Developer is on leave'
          };
        }
  
        // Check working hours
        const currentHour = currentDate.getHours();
        const startHour = parseInt(this.availability.workingHours.start);
        const endHour = parseInt(this.availability.workingHours.end);
  
        const withinWorkHours = currentHour >= startHour && currentHour < endHour;
  
        if (!withinWorkHours) {
          return {
            available: false,
            reason: 'Outside working hours'
          };
        }
  
        // Check project capacity
        const hasProjectCapacity = this.activeProjects.length < this.workload.maxProjects;
        const hasUpdateCapacity = this.currentUpdates.length < this.workload.maxUpdatesPerDay;
  
        return {
          available: hasProjectCapacity || hasUpdateCapacity,
          projectCapacity: hasProjectCapacity,
          updateCapacity: hasUpdateCapacity
        };
      } catch (error) {
        throw new Error(`Availability check failed: ${error.message}`);
      }
    }
  };
  
  // Middleware functions
  developerSchema.pre('save', async function(next) {
    // Update performance metrics if completed projects changed
    if (this.isModified('completedProjects')) {
      await this.updatePerformanceMetrics();
    }
  
    // Update status based on active projects and leaves
    if (this.isModified('activeProjects') || this.isModified('availability.leaves')) {
      const availabilityStatus = await this.checkAvailability();
      if (!availabilityStatus.available) {
        this.status = 'On Leave';
      } else if (this.activeProjects.length > 0) {
        this.status = 'Working';
      } else {
        this.status = 'Available';
      }
    }
  
    next();
  });
  
  // Create indexes for better query performance
  developerSchema.index({ employeeId: 1 }, { unique: true });
  developerSchema.index({ status: 1, 'performance.averageRating': -1 });
  developerSchema.index({ department: 1, designation: 1 });
  
  // Export the model
  const developerModel = mongoose.model('Developer', developerSchema)

  module.exports = developerModel