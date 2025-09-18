const fs = require("fs");
const path = require("path");

const DATA_PATH = path.join(__dirname, "../data.json");
const ATTACHMENTS_DIR = path.join(__dirname, "../attachments");

const DEFAULT_USERS = {
  ADMINS: ["@pippsza", "@teacher2"],
  ANSWER_VIEWERS: ["@pippsza", "@viewer2"],
};

function loadData() {
  if (fs.existsSync(DATA_PATH)) {
    try {
      const json = JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));
      if (!json.users) json.users = DEFAULT_USERS;
      return json;
    } catch (e) {
      return {
        users: DEFAULT_USERS,
        subjects: [],
        subjectEmojis: {},
      };
    }
  }
  return {
    users: DEFAULT_USERS,
    subjects: [],
    subjectEmojis: {},
  };
}

function saveData(data) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
}

function saveAttachment(fileId, buffer, ext = "") {
  const filePath = path.join(ATTACHMENTS_DIR, `${fileId}${ext}`);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

const data = loadData();

module.exports = {
  get users() {
    return data.users;
  },
  set users(val) {
    data.users = val;
    saveData(data);
  },
  get ADMINS() {
    return data.users.ADMINS;
  },
  get ANSWER_VIEWERS() {
    return data.users.ANSWER_VIEWERS;
  },
  set ADMINS(val) {
    data.users.ADMINS = val;
    saveData(data);
  },
  set ANSWER_VIEWERS(val) {
    data.users.ANSWER_VIEWERS = val;
    saveData(data);
  },
  get subjects() {
    return data.subjects;
  },
  get subjectEmojis() {
    return data.subjectEmojis || {};
  },
  set subjects(val) {
    data.subjects = val;
    saveData(data);
  },
  set subjectEmojis(val) {
    data.subjectEmojis = val;
    saveData(data);
  },
  save: () => saveData(data),
  saveAttachment,
  ATTACHMENTS_DIR,
  DATA_PATH,
};
