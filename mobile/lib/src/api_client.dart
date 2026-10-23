import 'dart:convert';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:http/http.dart' as http;

class ApiClient {
  ApiClient({this.baseUrl = 'http://10.0.2.2:8000/api/v1', this.allowInsecureLocal = false});

  final String baseUrl;
  final bool allowInsecureLocal;
  String? accessToken;
  String? sessionUserId;

  Future<bool> isOnline() async {
    final result = await Connectivity().checkConnectivity();
    return !result.contains(ConnectivityResult.none);
  }

  Future<bool> punch(Map<String, dynamic> payload) async {
    if (accessToken == null || sessionUserId == null) {
      throw StateError('Sessao autenticada obrigatoria');
    }
    final endpoint = Uri.parse('$baseUrl/attendance/punch');
    final localHost = {'localhost', '127.0.0.1', '10.0.2.2'}.contains(endpoint.host);
    if (endpoint.scheme != 'https' && !(allowInsecureLocal && localHost)) {
      throw StateError('HTTPS obrigatorio para transmitir biometria');
    }
    final response = await http.post(
      endpoint,
      headers: {
        'Content-Type': 'application/json',
        if (accessToken != null) 'Authorization': 'Bearer $accessToken',
      },
      body: jsonEncode(payload),
    ).timeout(const Duration(seconds: 15));
    if (response.statusCode >= 500) {
      throw Exception('API indisponivel');
    }
    if (response.statusCode == 401 || response.statusCode == 403) {
      throw StateError('Sessao expirada ou acesso negado');
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      return false;
    }
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    final record = body['record'];
    return body['accepted'] == true && record is Map &&
        record['id'] is String && (record['id'] as String).isNotEmpty &&
        record['occurred_at'] is String &&
        DateTime.tryParse(record['occurred_at'] as String) != null;
  }
}

