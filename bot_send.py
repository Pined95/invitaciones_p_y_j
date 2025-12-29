import tkinter as tk
from tkinter import ttk, messagebox
import requests
import pywhatkit
import time
import random
import json
import os
import threading

# ================= CONFIGURACIÓN =================
# 1. URL de tu Google Apps Script
API_URL = "https://script.google.com/macros/s/AKfycbyZcB1eZa1ZtK_E863gnjnL62-aLIp78H_VokUgexalyJvVflMRzpOyu4VB6-V13zI/exec"

# 2. URL de tu Invitación (SIN barra al final)
BASE_URL = "https://bodapaolayjorge.com.mx"

# Archivos locales
ARCHIVO_HISTORIAL = "historial_local.json"
ARCHIVO_JS_PUENTE = "historial_data.js"
ARCHIVO_CONFIG = "bot_config.json"
# =================================================

class WeddingBotApp:
    def __init__(self, root):
        self.root = root
        self.root.title("🤖 Robot P&J - Inteligencia Mejorada v4")
        self.root.geometry("850x900")
        self.root.configure(bg="#f4f4f9")

        self.is_running = False
        self.guests_data = []
        self.checkboxes = []
        self.vars = []

        # TÍTULO
        tk.Label(root, text="Panel de Envíos P&J", font=("Montserrat", 16, "bold"), bg="#f4f4f9", fg="#C59D5F").pack(pady=(10, 5))

        # --- EDITOR DE MENSAJE ---
        frame_editor = tk.LabelFrame(root, text=" 📝 Mensaje ", bg="#f4f4f9", font=("Arial", 10, "bold"))
        frame_editor.pack(fill="x", padx=20, pady=5)

        # Botones de variables
        frame_tools = tk.Frame(frame_editor, bg="#f4f4f9")
        frame_tools.pack(fill="x", padx=5, pady=2)
        tk.Label(frame_tools, text="Variables:", bg="#f4f4f9", fg="#666", font=("Arial", 9)).pack(side="left")
        self.create_var_btn(frame_tools, "{nombre}")
        self.create_var_btn(frame_tools, "{link}")
        self.create_var_btn(frame_tools, "{verbo}") # acompañaran/acompañaras

        self.txt_template = tk.Text(frame_editor, height=8, font=("Arial", 10), wrap="word", bd=1, relief="solid")
        self.txt_template.pack(fill="x", padx=10, pady=5)
        self.load_config()

        # --- LISTA DE INVITADOS ---
        # Aumentamos el tamaño de la lista para ver mejor los nombres largos
        frame_list_container = tk.LabelFrame(root, text=" 👥 Vista Previa (Nombre corregido + Verbo) ", bg="#f4f4f9", font=("Arial", 10, "bold"))
        frame_list_container.pack(fill="both", expand=True, padx=20, pady=5)

        btn_load = tk.Button(frame_list_container, text="🔄 Actualizar Lista desde Excel", command=self.load_data, bg="#3498db", fg="white", font=("Arial", 9, "bold"))
        btn_load.pack(pady=5)

        frame_scroll = tk.Frame(frame_list_container)
        frame_scroll.pack(fill="both", expand=True, padx=5, pady=5)
        scrollbar = tk.Scrollbar(frame_scroll)
        scrollbar.pack(side="right", fill="y")
        self.canvas = tk.Canvas(frame_scroll, bg="white")
        self.canvas.pack(side="left", fill="both", expand=True)
        self.inner_frame = tk.Frame(self.canvas, bg="white")
        self.canvas.create_window((0, 0), window=self.inner_frame, anchor="nw")
        scrollbar.config(command=self.canvas.yview)
        self.canvas.config(yscrollcommand=scrollbar.set)
        self.inner_frame.bind("<Configure>", lambda e: self.canvas.configure(scrollregion=self.canvas.bbox("all")))

        # Botones selección
        frame_sel = tk.Frame(frame_list_container, bg="#f4f4f9")
        frame_sel.pack(fill="x", padx=5, pady=5)
        tk.Button(frame_sel, text="Todos", command=self.select_all, bg="#ddd", font=("Arial", 8)).pack(side="left", padx=2)
        tk.Button(frame_sel, text="Ninguno", command=self.deselect_all, bg="#ddd", font=("Arial", 8)).pack(side="left", padx=2)
        self.lbl_count = tk.Label(frame_sel, text="0 seleccionados", bg="#f4f4f9", fg="#666")
        self.lbl_count.pack(side="right")

        # --- CONTROL ---
        self.progress = ttk.Progressbar(root, orient="horizontal", length=100, mode='determinate')
        self.progress.pack(fill="x", padx=20, pady=(10, 0))
        self.lbl_status = tk.Label(root, text="Esperando...", bg="#f4f4f9", fg="#333", font=("Courier", 9))
        self.lbl_status.pack(pady=2)

        frame_actions = tk.Frame(root, bg="#f4f4f9")
        frame_actions.pack(pady=15)
        self.btn_start = tk.Button(frame_actions, text="🚀 ENVIAR", command=self.start_thread, bg="#27ae60", fg="white", font=("Helvetica", 11, "bold"), padx=20, pady=10)
        self.btn_start.pack(side="left", padx=10)
        self.btn_stop = tk.Button(frame_actions, text="🛑 PARAR", command=self.stop_bot, bg="#c0392b", fg="white", font=("Helvetica", 11, "bold"), padx=20, pady=10, state="disabled")
        self.btn_stop.pack(side="left", padx=10)

        self.root.after(500, self.load_data)

    # =========================================================================
    # LÓGICA INTELIGENTE (AQUÍ ESTÁ LA CORRECCIÓN)
    # =========================================================================
    def calcular_nombre_y_verbo(self, guest):
        nombre_ind = (guest.get('nombre') or "").strip() # Juan
        nombre_grp = (guest.get('nombreGrupo') or "").strip() # Pineda Buenfild

        nombre_final = nombre_ind
        es_plural = False

        # --- CASO A: TIENE GRUPO DEFINIDO (Prioridad) ---
        # Si hay algo en 'nombreGrupo' y es diferente al nombre personal
        if nombre_grp and len(nombre_grp) > 2 and nombre_grp != nombre_ind:
            
            # 1. Asumimos plural automáticamente porque es un grupo
            es_plural = True 
            
            # 2. Revisar si agregamos "Familia"
            grp_lower = nombre_grp.lower()
            
            # Si NO dice familia, Y NO es una pareja (" y ", " e ", "&")
            if "familia" not in grp_lower and " y " not in grp_lower and "&" not in grp_lower and " e " not in grp_lower:
                # Es el caso "Pineda Buenfild" -> Lo convertimos a "Familia Pineda Buenfild"
                nombre_final = f"Familia {nombre_grp}"
            else:
                # Es el caso "Juan y María" o "Familia Pérez" -> Lo dejamos tal cual
                nombre_final = nombre_grp

        # --- CASO B: ES INDIVIDUAL (O grupo no definido) ---
        else:
            nombre_final = nombre_ind
            # Detectar si es plural por texto (ej. si en nombre pusieron "Juan y Ana")
            ind_lower = nombre_final.lower()
            if " y " in ind_lower or " e " in ind_lower or "&" in ind_lower:
                es_plural = True
            else:
                es_plural = False

        verbo = "acompañaran" if es_plural else "acompañaras"
        
        return nombre_final, verbo

    # =========================================================================

    def load_data(self):
        self.lbl_status.config(text="Conectando con Excel...")
        self.root.update()
        
        for cb in self.checkboxes: cb.destroy()
        self.checkboxes = []
        self.vars = []
        self.guests_data = []

        try:
            enviados = []
            if os.path.exists(ARCHIVO_HISTORIAL):
                with open(ARCHIVO_HISTORIAL, 'r', encoding='utf-8') as f:
                    enviados = json.load(f)

            res = requests.get(f"{API_URL}?action=getSendList")
            data = res.json()
            todos = data.get('guests', [])

            row = 0
            for p in todos:
                gid = str(p.get('groupId') or p.get('id'))
                if gid not in enviados:
                    p['_clean_id'] = gid
                    self.guests_data.append(p)
                    
                    # Calcular nombre corregido
                    nombre_final, verbo = self.calcular_nombre_y_verbo(p)
                    
                    var = tk.BooleanVar()
                    
                    # FRAME PARA LA FILA
                    frame_row = tk.Frame(self.inner_frame, bg="white")
                    frame_row.grid(row=row, column=0, sticky="w", padx=5, pady=2)
                    
                    cb = tk.Checkbutton(frame_row, variable=var, bg="white", command=self.update_count)
                    cb.pack(side="left")
                    
                    # MOSTRAR EL NOMBRE ORIGINAL
                    tk.Label(frame_row, text=p.get('nombre')[:20], fg="#888", bg="white", font=("Arial", 8), width=20, anchor="w").pack(side="left")
                    
                    # MOSTRAR LA FECHA --> AHORA MUESTRA EL NOMBRE FINAL Y VERBO
                    tk.Label(frame_row, text="➡", bg="white", fg="#ccc").pack(side="left", padx=5)
                    tk.Label(frame_row, text=f"{nombre_final}", fg="#2980b9", bg="white", font=("Arial", 9, "bold")).pack(side="left")
                    tk.Label(frame_row, text=f"({verbo})", fg="#27ae60", bg="white", font=("Arial", 8, "italic")).pack(side="left", padx=5)
                    
                    self.vars.append(var)
                    self.checkboxes.append(frame_row)
                    row += 1
            
            self.lbl_status.config(text=f"Carga completa. {len(self.guests_data)} pendientes.")
            self.update_count()

        except Exception as e:
            messagebox.showerror("Error", f"Error de conexión:\n{e}")
            self.lbl_status.config(text="Error.")

    def start_thread(self):
        self.save_config()
        indices = [i for i, v in enumerate(self.vars) if v.get()]
        if not indices:
            messagebox.showwarning("Atención", "Selecciona al menos uno.")
            return

        self.is_running = True
        self.btn_start.config(state="disabled")
        self.btn_stop.config(state="normal")
        threading.Thread(target=self.run_bot, args=(indices,), daemon=True).start()

    def run_bot(self, indices):
        total = len(indices)
        self.progress["maximum"] = total
        self.progress["value"] = 0
        success = 0
        template = self.txt_template.get("1.0", tk.END).strip()

        for i, idx in enumerate(indices):
            if not self.is_running: break
            
            guest = self.guests_data[idx]
            nombre_final, verbo = self.calcular_nombre_y_verbo(guest)
            
            self.update_ui_log(f"Enviando ({i+1}/{total}): {nombre_final}...")
            
            gid = guest['_clean_id']
            tel_raw = guest.get('telefono')
            tel = self.limpiar_telefono(tel_raw)
            link = f"{BASE_URL}?id={gid}"

            if not tel:
                self.update_ui_log(f"⚠️ Saltado: {nombre_final} (Sin cel)")
            else:
                try:
                    # REEMPLAZAR
                    msg = template.replace("{nombre}", nombre_final)\
                                  .replace("{link}", link)\
                                  .replace("{verbo}", verbo)
                    
                    pywhatkit.sendwhatmsg_instantly(tel, msg, 15, True, 3)
                    
                    self.registrar_envio(gid)
                    success += 1
                    
                    espera = random.randint(20, 45)
                    for s in range(espera, 0, -1):
                        if not self.is_running: break
                        self.update_ui_log(f"✅ Enviado a {nombre_final}. Esperando {s}s...")
                        time.sleep(1)
                except Exception as e:
                    self.update_ui_log(f"❌ Error: {e}")

            self.progress["value"] = i + 1
            self.root.after(0, lambda v=self.vars[idx]: v.set(False))

        self.is_running = False
        self.root.after(0, self.reset_ui)
        messagebox.showinfo("Fin", f"Proceso terminado. Enviados: {success}")

    def stop_bot(self):
        self.is_running = False
        self.lbl_status.config(text="🛑 Deteniendo...")

    # --- UTILIDADES ---
    def create_var_btn(self, parent, text):
        tk.Button(parent, text=text, command=lambda: self.insert_var(text), bg="#eef", fg="#2980b9", relief="flat", padx=5).pack(side="left", padx=5)

    def insert_var(self, text):
        self.txt_template.insert(tk.INSERT, text)
        self.save_config()

    def load_config(self):
        default = "¡Hola {nombre}! 👋\n\nNos encantaría que nos {verbo} en nuestra boda. 👰🤵\n\nAquí les dejo su invitación digital:\n{link}\n\n*¿Me confirman con un 'SÍ' si pudieron abrir el link?*"
        if os.path.exists(ARCHIVO_CONFIG):
            try:
                with open(ARCHIVO_CONFIG, 'r', encoding='utf-8') as f:
                    self.txt_template.insert("1.0", json.load(f).get("template", default))
            except: self.txt_template.insert("1.0", default)
        else: self.txt_template.insert("1.0", default)

    def save_config(self):
        with open(ARCHIVO_CONFIG, 'w', encoding='utf-8') as f:
            json.dump({"template": self.txt_template.get("1.0", tk.END).strip()}, f, ensure_ascii=False)

    def registrar_envio(self, gid):
        enviados = []
        if os.path.exists(ARCHIVO_HISTORIAL):
            with open(ARCHIVO_HISTORIAL, 'r', encoding='utf-8') as f:
                enviados = json.load(f)
        if gid not in enviados: enviados.append(gid)
        with open(ARCHIVO_HISTORIAL, 'w', encoding='utf-8') as f:
            json.dump(enviados, f, ensure_ascii=False, indent=4)
        with open(ARCHIVO_JS_PUENTE, 'w', encoding='utf-8') as f:
            f.write(f"window.BOT_ENVIADOS = {json.dumps(enviados)};")

    def limpiar_telefono(self, t):
        if not t: return None
        n = ''.join(filter(str.isdigit, str(t)))
        if len(n) == 10: return f"+521{n}"
        elif len(n) > 10: return f"+{n}"
        return None
    
    def update_ui_log(self, t): self.root.after(0, lambda: self.lbl_status.config(text=t))
    def update_count(self): self.lbl_count.config(text=f"{sum(1 for v in self.vars if v.get())} seleccionados")
    def select_all(self):
        for v in self.vars: v.set(True)
        self.update_count()
    def deselect_all(self):
        for v in self.vars: v.set(False)
        self.update_count()
    def reset_ui(self):
        self.btn_start.config(state="normal")
        self.btn_stop.config(state="disabled")
        self.lbl_status.config(text="Listo.")
        self.update_count()

if __name__ == "__main__":
    root = tk.Tk()
    app = WeddingBotApp(root)
    root.mainloop()