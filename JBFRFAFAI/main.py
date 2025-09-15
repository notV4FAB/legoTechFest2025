import tkinter as tk
import imageSelector
import imageCreator



# Configuración de la ventana principal
def start():
    # Funciones para los botones
    def crear_imagen():
        root.destroy()  # Cierra la ventana principal
        imageCreator.start()  # Llama a la función de crear imagen

    def obtener_imagen():
        root.destroy()  # Cierra la ventana principal
        imageSelector.start()  # Llama a la función de obtener imagen
    root = tk.Tk()
    root.title("App de Imágenes")
    root.attributes('-fullscreen', True)  # Pantalla completa
    root.configure(bg="#f5f5f5")  # Fondo claro

    # Contenedor central
    frame_central = tk.Frame(root, bg="#f5f5f5")
    frame_central.place(relx=0.5, rely=0.5, anchor="center")

    # Título
    titulo = tk.Label(frame_central, text="Selecciona una opción", font=("Arial", 30), bg="#f5f5f5", fg="#333333")
    titulo.pack(pady=50)

    # Contenedor de botones lado a lado
    frame_botones = tk.Frame(frame_central, bg="#f5f5f5")
    frame_botones.pack()

    # Botón Crear Imagen (izquierda)
    boton_crear = tk.Button(frame_botones, text="Crear Imagen", font=("Arial", 24), width=20, height=2, command=crear_imagen)
    boton_crear.pack(side="left", padx=50)

    # Botón Obtener Imagen (derecha)
    boton_obtener = tk.Button(frame_botones, text="Obtener Imagen", font=("Arial", 24), width=20, height=2, command=obtener_imagen)
    boton_obtener.pack(side="right", padx=50)

    # Tecla ESC para salir
    def end():
        root.destroy()
    root.bind("<Escape>", lambda e: end())

    root.mainloop()
start()