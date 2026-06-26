/* ============================================================
   MiniDayZ PC - Keyboard function keys
   Nạp SAU mod/keys.js (cần biến GAME_KEYS) và SAU zoom.js (cần applyGameZoom)
   ============================================================ */

// Lấy runtime của Construct 2 một cách an toàn (lazy: chỉ gọi khi đã load xong)
function getRT() {
	if (window.runtSCRIPT) return window.runtSCRIPT;
	if (typeof cr_getC2Runtime !== "undefined") {
		var rt = cr_getC2Runtime();
		if (rt) window.runtSCRIPT = rt; // cache lại
		return rt;
	}
	return null;
}

// Gọi 1 action trong event sheet theo đường dẫn obfuscated.
// page = 0 hoặc 1 (Ly['t495'][page]), idx = chỉ số event (Zk[idx]).
// Bọc try/catch + log để nếu index lệch thì không crash, dễ dò lại.
function triggerEvent(name, page, idx) {
	try {
		var rt = getRT();
		if (!rt) { console.warn("[keys] runtime chưa sẵn sàng cho:", name); return; }
		rt.Hr.Game_events.Ly['t495'][page].Zk[idx][0].VG();
		// console.log("[keys] OK:", name);
	} catch (err) {
		console.error("[keys] LỖI khi gọi '" + name + "' (page " + page + ", idx " + idx + "):", err);
	}
}

function RELOAD_INTER()    { triggerEvent("RELOAD",        0, 95); }
function PAD_INTER()       { triggerEvent("PAD_PAGE",      0, 31); }
function TAKE_I_INTER()    { triggerEvent("TAKE_ITENS",    1, 6);  }
function ATTACK_INTER()    { triggerEvent("SHOOT_FIREWP",  1, 0);  }
function SWICTH_WP_INTER() { triggerEvent("SWITCH_WEAPON", 1, 9);  }
function INVENTORY_INTER() { triggerEvent("INVENTORY",     1, 8);  }

// Trạng thái menu để Esc bấm lần nữa thì ĐÓNG, và để chuột không bắn khi đang ở menu.
var menuOpen = false;
function PAUSE_INTER() {
	try {
		if (!menuOpen) {
			c2_callFunction("options");          // mở pause menu
			menuOpen = true;
		} else {
			c2_callFunction("clear_pause_menu");  // = bấm Resume, đóng menu
			menuOpen = false;
		}
	} catch (err) { console.error("[keys] LỖI menu:", err); }
}

// Toggle toàn màn hình qua NW.js API
function FULLSCREEN_TOGGLE() {
	try {
		var win = nw.Window.get();
		win.toggleFullscreen();
	} catch (err) {
		console.error("[keys] LỖI fullscreen:", err);
	}
}

// Bỏ qua phím khi đang gõ vào ô input/textarea (nếu có)
function isTyping(e) {
	var t = e.target;
	return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
}

document.addEventListener("keyup", function (e) {
	if (isTyping(e)) return;
	var code = e.code.toLowerCase();
	switch (code) {
		case GAME_KEYS.RELOAD.toLowerCase():        RELOAD_INTER();    break;
		case GAME_KEYS.PAD_PAGE.toLowerCase():      PAD_INTER();       break;
		case GAME_KEYS.OPTIONS_MENU.toLowerCase():  PAUSE_INTER();     break;
		case GAME_KEYS.INVENTORY.toLowerCase():     INVENTORY_INTER(); break;
		case GAME_KEYS.SWITCH_WEAPON.toLowerCase(): SWICTH_WP_INTER(); break;
		default:
			// Nhặt đồ: E hoặc F
			if (code === GAME_KEYS.TAKE_ITENS.toLowerCase() ||
			    code === GAME_KEYS.TAKE_ITENS_ALT.toLowerCase()) {
				TAKE_I_INTER();
			}
	}
});

document.addEventListener("keydown", function (e) {
	if (isTyping(e)) return;
	var code = e.code.toLowerCase();
	// Tab mặc định chuyển focus -> chặn lại để không thoát khỏi game
	if (code === GAME_KEYS.INVENTORY.toLowerCase()) e.preventDefault();
	// F11 mặc định của trình duyệt/NW sẽ bị chặn để tự xử lý
	if (code === GAME_KEYS.FULLSCREEN.toLowerCase()) e.preventDefault();
	switch (code) {
		// Zoom dùng trực tiếp applyGameZoom() từ zoom.js gốc (giữ khi nhấn = zoom liên tục)
		case GAME_KEYS.ZOOM_IN.toLowerCase():
			if (typeof applyGameZoom === "function") applyGameZoom(0.1);
			break;
		case GAME_KEYS.ZOOM_OUT.toLowerCase():
			if (typeof applyGameZoom === "function") applyGameZoom(-0.1);
			break;
		case GAME_KEYS.FULLSCREEN.toLowerCase():
			FULLSCREEN_TOGGLE();
			break;
	}
});

/* ---------- CHUỘT: phải = bắn (trái tắt) ---------- */
// Chặn menu chuột phải của trình duyệt/NW
document.addEventListener("contextmenu", function (e) { e.preventDefault(); });

document.addEventListener("mousedown", function (e) {
	if (isTyping(e)) return;
	if (menuOpen) return; // đang mở menu thì không bắn
	if (e.button === 0 && MOUSE_KEYS.LEFT_SHOOT) {
		ATTACK_INTER(); // chuột trái = bắn (mặc định tắt)
	} else if (e.button === 2 && MOUSE_KEYS.RIGHT_SHOOT) {
		e.preventDefault();
		ATTACK_INTER(); // chuột phải = bắn
	}
});

console.log("[keys] Đã nạp. Chuột phải=bắn (tự nhắm địch gần nhất) |",
	"R=reload, E/F=nhặt đồ, Tab=túi đồ, Q=đổi vũ khí, C=pad, Esc=menu(bật/tắt), +/-=zoom, F11=toàn màn hình");
