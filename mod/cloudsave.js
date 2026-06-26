/* ============================================================
   MiniDayZ PC - Cloud Save qua Git
   Nạp SAU c2runtime.js. Cần Node + NW API (đã bật sẵn trong app này).

   Cơ chế:
     - MỞ game  -> git pull -> nếu save.json trên git mới hơn save máy này
                   thì nạp vào IndexedDB/localStorage rồi reload 1 lần.
     - TẮT game -> xuất toàn bộ save ra cloudsave/save.json -> git commit + push.

   CÀI ĐẶT (làm 1 lần, trên CẢ HAI máy): xem hướng dẫn ở cuối file
   hoặc file mod/CLOUDSAVE-README.txt
   ============================================================ */
(function () {
	"use strict";

	// ===================== CẤU HÌNH =====================
	// Thư mục repo git chứa save.json (mặc định: <thư mục game>/cloudsave).
	// Phải là 1 git repo đã có remote, đăng nhập sẵn trên cả 2 máy.
	var REPO_DIRNAME = "cloudsave";
	var SAVE_FILE    = "save-2.0.1.json";
	var GIT_TIMEOUT  = 30000; // ms cho mỗi lệnh git
	// ====================================================

	if (typeof require === "undefined") {
		console.warn("[cloudsave] Node không khả dụng -> bỏ qua cloud save.");
		return;
	}

	var fs   = require("fs");
	var path = require("path");
	var cp   = require("child_process");

	var APP_DIR   = process.cwd();
	var REPO_DIR  = path.join(APP_DIR, REPO_DIRNAME);
	var SAVE_PATH = path.join(REPO_DIR, SAVE_FILE);

	var LOCAL_TS_KEY = "cloudsave_local_ts";   // localStorage: ts của save đang có ở máy này
	var SYNCED_FLAG  = "cloudsave_synced";     // sessionStorage: đã sync trong phiên này chưa

	function log()  { console.log.apply(console, ["[cloudsave]"].concat([].slice.call(arguments))); }
	function warn() { console.warn.apply(console, ["[cloudsave]"].concat([].slice.call(arguments))); }

	// Env cấm git BẬT hỏi mật khẩu (nếu không sẽ TREO chờ nhập -> game đứng).
	var GIT_ENV = Object.assign({}, process.env, {
		GIT_TERMINAL_PROMPT: "0",      // không hỏi user/pass ở terminal
		GCM_INTERACTIVE: "never",      // Git Credential Manager không bật popup
		GIT_ASKPASS: "echo"            // fallback: trả rỗng thay vì chờ
	});

	function git(args) {
		return cp.execSync("git " + args, {
			cwd: REPO_DIR, encoding: "utf8", timeout: GIT_TIMEOUT,
			stdio: ["ignore", "pipe", "pipe"], env: GIT_ENV
		});
	}
	function gitSafe(args) { try { return git(args); } catch (e) { warn("git " + args + " lỗi:", (e.message || e)); return null; } }

	// Bản BẤT ĐỒNG BỘ: KHÔNG khóa luồng chính (UI không đứng khi mở game).
	function gitAsync(args) {
		return new Promise(function (resolve) {
			cp.exec("git " + args, { cwd: REPO_DIR, encoding: "utf8", timeout: GIT_TIMEOUT, env: GIT_ENV },
				function (err, stdout) { if (err) warn("git " + args + " lỗi:", (err.message || err)); resolve(err ? null : stdout); });
		});
	}

	/* ---------- mã hoá giá trị (kể cả Blob/ArrayBuffer) sang JSON ---------- */
	function abToB64(buf) {
		var bytes = new Uint8Array(buf), bin = "", CH = 0x8000;
		for (var i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
		return btoa(bin);
	}
	function b64ToAb(b64) {
		var bin = atob(b64), len = bin.length, bytes = new Uint8Array(len);
		for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
		return bytes.buffer;
	}
	function blobToB64(blob) {
		return new Promise(function (res, rej) {
			var r = new FileReader();
			r.onload = function () { var s = r.result; res(s.slice(s.indexOf(",") + 1)); };
			r.onerror = function () { rej(r.error); };
			r.readAsDataURL(blob);
		});
	}
	async function encodeVal(v) {
		if (v instanceof Blob)              return { __t: "blob", mime: v.type, b64: await blobToB64(v) };
		if (v instanceof ArrayBuffer)       return { __t: "ab", b64: abToB64(v) };
		if (ArrayBuffer.isView(v))          return { __t: "ta", ctor: v.constructor.name, b64: abToB64(v.buffer) };
		return v; // JSON-safe sẵn (string/number/object/array)
	}
	function decodeVal(v) {
		if (v && typeof v === "object" && v.__t) {
			if (v.__t === "blob") return new Blob([b64ToAb(v.b64)], { type: v.mime || "" });
			if (v.__t === "ab")   return b64ToAb(v.b64);
			if (v.__t === "ta")   { var C = window[v.ctor] || Uint8Array; return new C(b64ToAb(v.b64)); }
		}
		return v;
	}

	/* ---------- xuất / nhập IndexedDB ---------- */
	function dumpDB(name) {
		return new Promise(function (resolve, reject) {
			var req = indexedDB.open(name);
			req.onerror = function () { reject(req.error); };
			req.onsuccess = async function () {
				var db = req.result;
				var out = { version: db.version, stores: {} };
				var names = [].slice.call(db.objectStoreNames);
				if (!names.length) { db.close(); return resolve(out); }
				try {
					for (var n = 0; n < names.length; n++) {
						var sn = names[n];
						var meta = await new Promise(function (res, rej) {
							var tx = db.transaction(sn, "readonly");
							var st = tx.objectStore(sn);
							var m = { keyPath: st.keyPath, autoIncrement: st.autoIncrement, indexes: [], rows: [] };
							for (var ix = 0; ix < st.indexNames.length; ix++) {
								var idx = st.index(st.indexNames[ix]);
								m.indexes.push({ name: idx.name, keyPath: idx.keyPath, unique: idx.unique, multiEntry: idx.multiEntry });
							}
							var gk = st.getAllKeys(), gv = st.getAll(), K, V, dk = false, dv = false;
							gk.onsuccess = function () { K = gk.result; dk = true; fin(); };
							gv.onsuccess = function () { V = gv.result; dv = true; fin(); };
							gk.onerror = gv.onerror = function () { rej(this.error); };
							async function fin() {
								if (!(dk && dv)) return;
								for (var i = 0; i < V.length; i++) m.rows.push({ key: K[i], value: await encodeVal(V[i]) });
								res(m);
							}
						});
						out.stores[sn] = meta;
					}
					db.close(); resolve(out);
				} catch (e) { db.close(); reject(e); }
			};
		});
	}

	function restoreDB(name, info) {
		return new Promise(function (resolve, reject) {
			var req = indexedDB.open(name, info.version || undefined);
			req.onupgradeneeded = function () {
				var db = req.result;
				Object.keys(info.stores).forEach(function (sn) {
					if (db.objectStoreNames.contains(sn)) return;
					var sm = info.stores[sn];
					var st = db.createObjectStore(sn, { keyPath: sm.keyPath || null, autoIncrement: !!sm.autoIncrement });
					(sm.indexes || []).forEach(function (i) { try { st.createIndex(i.name, i.keyPath, { unique: i.unique, multiEntry: i.multiEntry }); } catch (e) {} });
				});
			};
			req.onerror = function () { reject(req.error); };
			req.onsuccess = function () {
				var db = req.result;
				var names = Object.keys(info.stores).filter(function (s) { return db.objectStoreNames.contains(s); });
				if (!names.length) { db.close(); return resolve(); }
				var tx = db.transaction(names, "readwrite");
				tx.oncomplete = function () { db.close(); resolve(); };
				tx.onerror = function () { db.close(); reject(tx.error); };
				names.forEach(function (sn) {
					var st = tx.objectStore(sn), sm = info.stores[sn];
					st.clear();
					sm.rows.forEach(function (row) {
						var val = decodeVal(row.value);
						if (st.keyPath != null) st.put(val);        // in-line key
						else                    st.put(val, row.key); // out-of-line key
					});
				});
			};
		});
	}

	/* ---------- export / import toàn bộ ---------- */
	async function exportSave() {
		var data = { v: 1, ts: Date.now(), localStorage: {}, idb: {} };
		for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); data.localStorage[k] = localStorage.getItem(k); }
		var dbs = [];
		try { dbs = await indexedDB.databases(); } catch (e) { warn("không liệt kê được IndexedDB:", e.message); }
		for (var d = 0; d < dbs.length; d++) {
			if (!dbs[d].name) continue;
			try { data.idb[dbs[d].name] = await dumpDB(dbs[d].name); } catch (e) { warn("dump DB '" + dbs[d].name + "' lỗi:", e.message); }
		}
		return data;
	}
	async function importSave(data) {
		if (data.localStorage) Object.keys(data.localStorage).forEach(function (k) {
			if (k === LOCAL_TS_KEY) return; // ts quản lý riêng
			localStorage.setItem(k, data.localStorage[k]);
		});
		if (data.idb) { var names = Object.keys(data.idb); for (var i = 0; i < names.length; i++) {
			try { await restoreDB(names[i], data.idb[names[i]]); } catch (e) { warn("restore DB '" + names[i] + "' lỗi:", e.message); }
		} }
	}

	/* ---------- LÚC MỞ GAME: pull + import ---------- */
	async function onOpen() {
		if (sessionStorage.getItem(SYNCED_FLAG)) { attachCloseHook(); return; }

		if (!fs.existsSync(REPO_DIR)) {
			warn("Chưa có thư mục repo:", REPO_DIR, "- bỏ qua. Xem hướng dẫn cài đặt.");
			sessionStorage.setItem(SYNCED_FLAG, "1"); attachCloseHook(); return;
		}
		await gitAsync("pull --ff-only");   // BẤT ĐỒNG BỘ -> không làm đứng game lúc load

		if (fs.existsSync(SAVE_PATH)) {
			try {
				var remote = JSON.parse(fs.readFileSync(SAVE_PATH, "utf8"));
				var localTs = Number(localStorage.getItem(LOCAL_TS_KEY) || 0);
				if (remote && remote.ts && remote.ts > localTs) {
					log("Save trên git mới hơn (" + new Date(remote.ts).toLocaleString() + ") -> đang nạp...");
					await importSave(remote);
					localStorage.setItem(LOCAL_TS_KEY, String(remote.ts));
					sessionStorage.setItem(SYNCED_FLAG, "1");
					log("Đã nạp save từ git. Tải lại game...");
					location.reload();
					return;
				}
				log("Save máy này đã mới nhất, không cần nạp.");
			} catch (e) { warn("đọc save.json lỗi:", e.message); }
		} else {
			log("Chưa có save.json trên git (lần đầu) - sẽ tạo khi tắt game.");
		}
		sessionStorage.setItem(SYNCED_FLAG, "1");
		attachCloseHook();
	}

	/* ---------- LÚC TẮT GAME: export + push ---------- */
	var closing = false;
	function attachCloseHook() {
		if (typeof nw === "undefined") { warn("không có NW API -> không tự push lúc tắt."); return; }
		var win;
		try { win = nw.Window.get(); } catch (e) { warn("không lấy được cửa sổ NW:", e.message); return; }
		win.removeAllListeners("close");
		win.on("close", function () {
			var self = this;
			if (closing) { return; }
			closing = true;
			log("Đang lưu & đẩy save lên git trước khi thoát...");
			exportSave().then(function (data) {
				if (!fs.existsSync(REPO_DIR)) fs.mkdirSync(REPO_DIR, { recursive: true });
				fs.writeFileSync(SAVE_PATH, JSON.stringify(data));
				localStorage.setItem(LOCAL_TS_KEY, String(data.ts));
				gitSafe("add -A");
				gitSafe('commit -m "save ' + new Date(data.ts).toISOString() + '"');
				if (gitSafe("push") === null) gitSafe("push -u origin HEAD"); // lần đầu: set upstream
				log("Xong. Đã đẩy save lên git.");
			}).catch(function (e) {
				warn("export lỗi (vẫn thoát game):", e.message);
			}).then(function () { self.close(true); });
		});
	}

	// chạy sớm nhưng sau khi DOM sẵn sàng
	if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", onOpen);
	else onOpen();

	// cho phép gọi tay trong DevTools để kiểm tra
	window.cloudSaveExportNow = function () { return exportSave(); };
	window.cloudSaveImportNow = function (data) { return importSave(data); };
	window.cloudSaveInfo = function () { return { REPO_DIR: REPO_DIR, SAVE_PATH: SAVE_PATH, localTs: localStorage.getItem(LOCAL_TS_KEY) }; };

	log("Đã nạp. repo:", REPO_DIR);
})();
