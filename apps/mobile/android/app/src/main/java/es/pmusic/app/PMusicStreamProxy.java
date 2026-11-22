package es.pmusic.app;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;

public class PMusicStreamProxy {
    private ServerSocket serverSocket;
    private volatile boolean running = false;

    public int start() throws IOException {
        if (serverSocket != null && !serverSocket.isClosed()) {
            return serverSocket.getLocalPort();
        }
        serverSocket = new ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"));
        running = true;
        Thread worker = new Thread(this::acceptLoop, "PMusicStreamProxy");
        worker.setDaemon(true);
        worker.start();
        return serverSocket.getLocalPort();
    }

    private void acceptLoop() {
        while (running && serverSocket != null && !serverSocket.isClosed()) {
            try {
                Socket client = serverSocket.accept();
                OutputStream out = client.getOutputStream();
                String headers = "HTTP/1.1 206 Partial Content\r\n"
                        + "Access-Control-Allow-Origin: *\r\n"
                        + "Accept-Ranges: bytes\r\n"
                        + "Content-Type: audio/wav\r\n\r\n";
                out.write(headers.getBytes("UTF-8"));
                out.flush();
                client.close();
            } catch (IOException ignored) {
            }
        }
    }

    public void stop() {
        running = false;
        try {
            if (serverSocket != null) serverSocket.close();
        } catch (IOException ignored) {
        }
    }
}
