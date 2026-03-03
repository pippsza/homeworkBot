const Subject = require("../models/Subject");

module.exports = {
  async getAll() {
    return Subject.find().sort({ order: 1 });
  },

  async getById(id) {
    return Subject.findById(id);
  },

  async getByTaskId(taskId) {
    return Subject.findOne({ "tasks._id": taskId });
  },

  async create(data) {
    const count = await Subject.countDocuments();
    return Subject.create({ ...data, order: count });
  },

  async update(id, data) {
    return Subject.findByIdAndUpdate(id, data, { returnDocument: "after" });
  },

  async delete(id) {
    return Subject.findByIdAndDelete(id);
  },

  async addTask(subjectId, taskData) {
    const subject = await Subject.findById(subjectId);
    if (!subject) return null;
    subject.tasks.push(taskData);
    await subject.save();
    return subject.tasks[subject.tasks.length - 1];
  },

  async getTask(taskId) {
    const subject = await this.getByTaskId(taskId);
    if (!subject) return { subject: null, task: null };
    return { subject, task: subject.tasks.id(taskId) };
  },

  async updateTask(taskId, updates) {
    const subject = await this.getByTaskId(taskId);
    if (!subject) return null;
    const task = subject.tasks.id(taskId);
    Object.assign(task, updates);
    await subject.save();
    return { subject, task };
  },

  async deleteTask(taskId) {
    const subject = await this.getByTaskId(taskId);
    if (!subject) return null;
    const task = subject.tasks.id(taskId);
    const title = task.title;
    subject.tasks.pull(taskId);
    await subject.save();
    return { subject, title };
  },

  async addAnswer(taskId, answerData) {
    const subject = await this.getByTaskId(taskId);
    if (!subject) return null;
    const task = subject.tasks.id(taskId);
    task.answers.push(answerData);
    await subject.save();
    return { subject, task };
  },

  async setTaskAttachments(taskId, attachments) {
    const subject = await this.getByTaskId(taskId);
    if (!subject) return null;
    const task = subject.tasks.id(taskId);
    task.attachments = attachments;
    await subject.save();
    return { subject, task };
  },

  async setSubmission(taskId, username, submitted) {
    const subject = await this.getByTaskId(taskId);
    if (!subject) return { subject: null, task: null };
    const task = subject.tasks.id(taskId);
    if (!task) return { subject: null, task: null };
    const existing = task.submissions.find((s) => s.username === username);
    if (existing) {
      existing.submitted = submitted;
    } else {
      task.submissions.push({ username, submitted });
    }
    await subject.save();
    return { subject, task };
  },
};
