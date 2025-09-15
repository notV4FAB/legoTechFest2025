import os
from flask import Flask, send_from_directory
import threading
import tkinter as tk
from tkinter import messagebox
from PIL import Image, ImageTk
import qrcode
import main
from google import drive

def start():
    # ----------------- CONFIGURACIÓN -----------------
    RUTA_IMAGENES = os.path.join("createdimg")
    EXT = ".png"
    SERVER_PORT = 5000  # Puerto para Flask

    # ----------------- SERVIDOR FLASK -----------------
    app = Flask(__name__)

    @app.route("/download/<filename>")
    def download_image(filename):
        """Sirve la imagen con header de descarga"""
        return send_from_directory(RUTA_IMAGENES, filename, as_attachment=True)

    def start_flask():
        threading.Thread(
            target=lambda: app.run(host="0.0.0.0", port=SERVER_PORT, debug=False, use_reloader=False),
            daemon=True
        ).start()

    # ----------------- FUNCIONES -----------------
    def get_img_path(search_id):
        return os.path.join(RUTA_IMAGENES, search_id + EXT)

    def get_local_ip():
        """Devuelve la IP local de la PC para el QR"""
        import socket
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
        except:
            ip = "127.0.0.1"
        finally:
            s.close()
        return ip

    def generar_qr(img_path):
        """Genera QR que descarga la imagen"""
        filename = os.path.basename(img_path)
        ip = get_local_ip()
        url = f"http://{ip}:{SERVER_PORT}/download/{filename}"
        qr = qrcode.make(url)
        qr_path = "JBFRFAFAI\qr\qr.png"
        qr.save(qr_path)
        return qr_path, url

    def mostrar_imagen_y_qr(search_id):
        img_path = get_img_path(search_id)
        if not os.path.exists(img_path):
            messagebox.showerror("Error", "No se encontró la imagen")
            return

        # Limpiar ventana
        for widget in ventana.winfo_children():
            widget.destroy()

        # Título arriba
        tk.Label(ventana, text=f"Imagen encontrada: {search_id}", font=("Arial", 24, "bold")).pack(pady=20)

        # Frame horizontal para imagen y QR
        frame = tk.Frame(ventana)
        frame.pack(pady=10, expand=True, fill="both")

        # ----------------- IZQUIERDA: Imagen -----------------
        img_frame = tk.Frame(frame)
        img_frame.pack(side="left", padx=50, expand=True)

        img = Image.open(img_path).resize((400,400))
        tk_img = ImageTk.PhotoImage(img)
        panel = tk.Label(img_frame, image=tk_img)
        panel.image = tk_img
        panel.pack()

        # Botón debajo de la imagen
        tk.Button(
            img_frame,
            text="Volver al inicio",
            font=("Arial", 16),
            bg="#4CAF50", fg="white",
            command=inicio_app
        ).pack(pady=20)

        # ----------------- DERECHA: QR -----------------
        qr_frame = tk.Frame(frame)
        qr_frame.pack(side="right", padx=50, expand=True)

        qr_path, url = generar_qr(img_path)
        qr_img = Image.open(qr_path).resize((300,300))
        tk_qr = ImageTk.PhotoImage(qr_img)
        qr_panel = tk.Label(qr_frame, image=tk_qr)
        qr_panel.image = tk_qr
        qr_panel.pack()

        # Texto debajo del QR
        tk.Label(
            qr_frame,
            text="Escanea el QR para descargar la imagen",
            font=("Arial", 14)
        ).pack(pady=10)

        tk.Label(
            qr_frame,
            text=f"o abre este link en tu celular:\n{url}",
            font=("Arial", 12),
            wraplength=300
        ).pack(pady=5)


    def inicio_app():
        """Pantalla inicial centrada con botón grande"""
        for widget in ventana.winfo_children():
            widget.destroy()

        # Frame central para centrar vertical y horizontalmente
        central_frame = tk.Frame(ventana)
        central_frame.place(relx=0.5, rely=0.5, anchor="center")

        # Título
        tk.Label(
            central_frame,
            text="Obtenedor de imágenes con QR",
            font=("Arial", 36, "bold")
        ).pack(pady=40)

        # Instrucción
        tk.Label(
            central_frame,
            text="Escribe el ID de tu imagen:",
            font=("Arial", 24)
        ).pack(pady=20)

        # Entry grande
        entry = tk.Entry(central_frame, font=("Arial", 24), width=15)
        entry.pack(pady=10)
        entry.focus_set()  # poner el cursor en el entry al inicio

        # Botón grande
        buscar_btn = tk.Button(
            central_frame,
            text="Buscar imagen",
            font=("Arial", 28),
            bg="#2196F3", fg="white",
            width=15,
            command=lambda: mostrar_imagen_y_qr(entry.get().strip())
        )
        buscar_btn.pack(pady=30)

        # Solo el botón se activa con Enter
        ventana.bind("<Return>", lambda event: buscar_btn.invoke())


    # ----------------- INTERFAZ -----------------
    ventana = tk.Tk()
    ventana.geometry("450x800")
    ventana.title("Obtenedor de imágenes con QR")
    ventana.attributes("-fullscreen", True)
    inicio_app()

    # Arrancar servidor Flask en segundo plano
    start_flask()
    def end():
        ventana.destroy()
        main.start()

    ventana.bind("<Escape>", lambda e: end())

    ventana.mainloop()
