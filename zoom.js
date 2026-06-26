(function() {

    var currentZOOM = 1.0;
    const MIN_ZOOM = 0.7;
    const MAX_ZOOM = 4.2;
    const STEP = 0.1;

    
    window.applyGameZoom = function(delta) {

        var rt = window.runtSCRIPT;
        if (!rt && typeof cr_getC2Runtime !== "undefined") rt = cr_getC2Runtime();
        
        if (!rt) {
            console.log("Движок игры еще не загружен...");
            return;
        }


        currentZOOM += delta;
        if (currentZOOM < MIN_ZOOM) currentZOOM = MIN_ZOOM;
        if (currentZOOM > MAX_ZOOM) currentZOOM = MAX_ZOOM;

        try {
            
            if (rt.wj && rt.wj.autozoom) {
                rt.wj.autozoom.ci = false;
            }

            
            if (rt.Fs && rt.Fs.Map && rt.Fs.Map.ua) {
                var layers = rt.Fs.Map.ua;
                

                for (var i = 0; i < 51; i++) {
                    if (layers[i]) layers[i].scale = currentZOOM;
                }
                
                
                if (layers[61]) layers[61].scale = currentZOOM;
                
                console.log("Зум установлен на:", currentZOOM);
                rt.redraw = true; // 
            }
        } catch(err) {
            console.error("Ошибка при применении зума:", err);
        }
    };


    function createZoomButtons() {
        if (document.getElementById('custom-zoom-ui')) return;

        const ui = document.createElement("div");
        ui.id = 'custom-zoom-ui';
        
        ui.style = "position:fixed; bottom:0px; left:80px; z-index:999999; display:flex; gap:15px; pointer-events:none;";
        
        
        const btnStyle = "width:40px; height:40px; cursor:pointer; pointer-events:auto; background:transparent; border:none; display:flex; align-items:center; justify-content:center; transition: transform 0.1s;";
        
        ui.innerHTML = `
            <div onclick="window.applyGameZoom(${STEP})" style="${btnStyle}" onmousedown="this.style.transform='scale(0.9)'" onmouseup="this.style.transform='scale(1)'">
                <img src="images/zoom_in-sheet0.png" style="width:100%; height:100%; object-fit:contain;" onerror="this.innerText='+'">
            </div>
            <div onclick="window.applyGameZoom(-${STEP})" style="${btnStyle}" onmousedown="this.style.transform='scale(0.9)'" onmouseup="this.style.transform='scale(1)'">
                <img src="images/zoom_out-sheet0.png" style="width:100%; height:100%; object-fit:contain;" onerror="this.innerText='-'">
            </div>
        `;
        document.body.appendChild(ui);
    }

    if (document.readyState === "complete") createZoomButtons();
    else window.addEventListener("load", createZoomButtons);
})();