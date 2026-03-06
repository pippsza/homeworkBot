import Subject, { ISubject, ISubjectAttachment, IAnswer, ISubmission, ITask } from "../models/Subject";

export async function getAll(): Promise<ISubject[]> {
  return Subject.find().sort({ order: 1 });
}

export async function getById(id: string): Promise<ISubject | null> {
  return Subject.findById(id);
}

export async function getByTaskId(taskId: string): Promise<ISubject | null> {
  return Subject.findOne({ "tasks._id": taskId });
}

export async function create(data: Partial<ISubject>): Promise<ISubject> {
  const count = await Subject.countDocuments();
  return Subject.create({ ...data, order: count });
}

export async function update(id: string, data: Partial<ISubject>): Promise<ISubject | null> {
  return Subject.findByIdAndUpdate(id, data, { returnDocument: "after" });
}

export async function deleteSubject(id: string): Promise<ISubject | null> {
  return Subject.findByIdAndDelete(id);
}

export async function addTask(subjectId: string, taskData: Partial<ITask>): Promise<ITask | null> {
  const subject = await Subject.findById(subjectId);
  if (!subject) return null;
  subject.tasks.push(taskData as ITask);
  await subject.save();
  return subject.tasks[subject.tasks.length - 1];
}

export async function getTask(taskId: string): Promise<{ subject: ISubject | null; task: ITask | null }> {
  const subject = await getByTaskId(taskId);
  if (!subject) return { subject: null, task: null };
  return { subject, task: subject.tasks.id(taskId) };
}

export async function updateTask(taskId: string, updates: Partial<ITask>): Promise<{ subject: ISubject; task: ITask } | null> {
  const subject = await getByTaskId(taskId);
  if (!subject) return null;
  const task = subject.tasks.id(taskId)!;
  Object.assign(task, updates);
  await subject.save();
  return { subject, task: task! };
}

export async function deleteTask(taskId: string): Promise<{ subject: ISubject; title: string } | null> {
  const subject = await getByTaskId(taskId);
  if (!subject) return null;
  const task = subject.tasks.id(taskId);
  const title = task!.title;
  subject.tasks.pull(taskId);
  await subject.save();
  return { subject, title };
}

export async function addAnswer(taskId: string, answerData: Partial<IAnswer>): Promise<{ subject: ISubject; task: ITask } | null> {
  const subject = await getByTaskId(taskId);
  if (!subject) return null;
  const task = subject.tasks.id(taskId)!;
  task.answers.push(answerData as IAnswer);
  await subject.save();
  return { subject, task };
}

export async function setTaskAttachments(taskId: string, attachments: ISubjectAttachment[]): Promise<{ subject: ISubject; task: ITask } | null> {
  const subject = await getByTaskId(taskId);
  if (!subject) return null;
  const task = subject.tasks.id(taskId)!;
  task.attachments = attachments;
  await subject.save();
  return { subject, task };
}

export async function setSubmission(taskId: string, username: string, submitted: boolean): Promise<{ subject: ISubject | null; task: ITask | null }> {
  const subject = await getByTaskId(taskId);
  if (!subject) return { subject: null, task: null };
  const task = subject.tasks.id(taskId);
  if (!task) return { subject: null, task: null };
  const existing = task.submissions.find((s: ISubmission) => s.username === username);
  if (existing) {
    existing.submitted = submitted;
  } else {
    task.submissions.push({ username, submitted });
  }
  await subject.save();
  return { subject, task };
}

export { deleteSubject as delete };
